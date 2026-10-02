// ---------------------------------------------------------------------------
// Retry Policy & Provider Circuit Breaker
// Task: T009 implementation — Five total provider calls per stage, transient-
// only exponential backoff with jitter, Retry-After support, permanent-error
// escalation, and provider-specific circuit breakers (FR-018/FR-022).
// ---------------------------------------------------------------------------

import { randomInt } from "node:crypto";

/** Maximum total provider calls per workflow stage, including the initial call. */
export const MAX_STAGE_ATTEMPTS = 5;

/** Returns true while the stage still has attempts left (0-based attempt count). */
export function shouldRetryStage(attemptsMade: number): boolean {
	return attemptsMade < MAX_STAGE_ATTEMPTS;
}

/**
 * Computes the backoff delay for a transient failure.
 * Exponential base with jitter; a provider Retry-After value wins.
 */
export function computeBackoffDelay(
	attempt: number,
	baseDelayMs: number,
	retryAfterMs?: number,
): number {
	if (retryAfterMs !== undefined && retryAfterMs > 0) {
		return retryAfterMs;
	}
	const exponential = baseDelayMs * 2 ** (attempt - 1);
	// Jitter between 100% and 200% of the exponential delay
	return Math.round(exponential * (1 + randomInt(0, 1001) / 1000));
}

/**
 * Permanent client errors are not retried automatically (FR-018).
 * 429 (rate limit) is transient; 5xx and network errors are transient.
 */
export function isPermanentProviderError(status: number): boolean {
	if (status >= 500 || status === 429) {
		return false;
	}
	return status >= 400;
}

export interface CircuitBreakerOptions {
	/** Consecutive transient failures within windowMs that open the circuit. */
	failureThreshold: number;
	/** Sliding window for counting consecutive failures. */
	windowMs: number;
	/** How long the circuit stays open before allowing one half-open probe. */
	openMs: number;
}

type BreakerState = "closed" | "open" | "half-open";

/**
 * Provider-specific, process-local circuit breaker (FR-022).
 * Five consecutive transient failures within 60s open the circuit for 30s,
 * then one half-open probe is allowed. A successful probe closes the
 * circuit and resets the failure count; a transient probe failure reopens
 * it. Permanent client errors do not count toward opening the circuit.
 */
export class CircuitBreaker {
	private state: BreakerState = "closed";
	private failureTimestamps: number[] = [];
	private openUntil = 0;
	private halfOpenProbeInFlight = false;

	constructor(private readonly options: CircuitBreakerOptions) {}

	isOpen(): boolean {
		if (this.state === "open") {
			if (Date.now() >= this.openUntil) {
				this.state = "half-open";
				this.halfOpenProbeInFlight = false;
				return false;
			}
			return true;
		}
		return false;
	}

	/** True when a call may be attempted (closed or half-open probe). */
	canAttempt(): boolean {
		if (this.isOpen()) return false;
		if (this.state === "half-open") {
			if (this.halfOpenProbeInFlight) return false;
			this.halfOpenProbeInFlight = true;
		}
		return true;
	}

	recordSuccess(): void {
		this.state = "closed";
		this.failureTimestamps = [];
		this.openUntil = 0;
		this.halfOpenProbeInFlight = false;
	}

	scheduleReopen(delayMs: number): void {
		this.state = "open";
		this.openUntil = Date.now() + delayMs;
		this.halfOpenProbeInFlight = false;
	}

	recordFailure(): void {
		const now = Date.now();
		this.failureTimestamps.push(now);
		// Keep only failures inside the sliding window
		this.failureTimestamps = this.failureTimestamps.filter((t) => now - t <= this.options.windowMs);

		if (this.state === "half-open") {
			// Transient half-open failure reopens the circuit
			this.state = "open";
			this.openUntil = now + this.options.openMs;
			this.halfOpenProbeInFlight = false;
			return;
		}

		if (this.failureTimestamps.length >= this.options.failureThreshold) {
			this.state = "open";
			this.openUntil = now + this.options.openMs;
		}
	}

	/** Releases a half-open probe after a non-transient provider response. */
	recordNonTransientFailure(): void {
		if (this.state === "half-open") {
			this.state = "closed";
			this.failureTimestamps = [];
			this.openUntil = 0;
		}
		this.halfOpenProbeInFlight = false;
	}
}
