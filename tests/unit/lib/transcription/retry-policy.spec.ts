// ---------------------------------------------------------------------------
// Unit Tests: Retry Policy & Circuit Breaker
// Task: T009 [P] — Failing tests for a per-stage maximum of five actual
// provider calls, transient-only exponential backoff with jitter, honoring
// Retry-After, immediate escalation of permanent failures, and
// provider-specific circuit-breaker open/half-open/closed behavior.
// ---------------------------------------------------------------------------

import {
	CircuitBreaker,
	computeBackoffDelay,
	isPermanentProviderError,
	shouldRetryStage,
} from "@/lib/transcription/retry-policy";
import { describe, expect, it, vi } from "vitest";

describe("per-stage attempt cap", () => {
	it("allows at most five total provider calls per stage", () => {
		expect(shouldRetryStage(0)).toBe(true);
		expect(shouldRetryStage(4)).toBe(true);
		expect(shouldRetryStage(5)).toBe(false);
		expect(shouldRetryStage(6)).toBe(false);
	});
});

describe("backoff computation", () => {
	it("uses exponential backoff with jitter for transient failures", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const base = 1000;
		expect(computeBackoffDelay(1, base)).toBe(1500);
		expect(computeBackoffDelay(2, base)).toBe(3000);
		expect(computeBackoffDelay(3, base)).toBe(6000);
		vi.restoreAllMocks();
	});

	it("honors a provider Retry-After header over the computed delay", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const retryAfterMs = 10_000;
		expect(computeBackoffDelay(1, 1000, retryAfterMs)).toBe(10_000);
		vi.restoreAllMocks();
	});

	it("keeps a circuit open until the provider Retry-After delay expires", () => {
		vi.useFakeTimers();
		const breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 });
		breaker.scheduleReopen(10_000);
		expect(breaker.isOpen()).toBe(true);
		vi.advanceTimersByTime(10_000);
		expect(breaker.isOpen()).toBe(false);
		vi.useRealTimers();
	});
});

describe("permanent error escalation", () => {
	it("does not retry permanent client errors automatically", () => {
		expect(isPermanentProviderError(400)).toBe(true);
		expect(isPermanentProviderError(401)).toBe(true);
		expect(isPermanentProviderError(403)).toBe(true);
		expect(isPermanentProviderError(422)).toBe(true);
	});

	it("treats 5xx and network errors as transient", () => {
		expect(isPermanentProviderError(500)).toBe(false);
		expect(isPermanentProviderError(503)).toBe(false);
		expect(isPermanentProviderError(429)).toBe(false);
	});
});

describe("provider-specific circuit breaker", () => {
	it("opens after five consecutive transient failures within 60 seconds", () => {
		const breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 });
		for (let i = 0; i < 5; i += 1) {
			breaker.recordFailure();
		}
		expect(breaker.isOpen()).toBe(true);
	});

	it("does not open before five consecutive failures", () => {
		const breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 });
		for (let i = 0; i < 4; i += 1) {
			breaker.recordFailure();
		}
		expect(breaker.isOpen()).toBe(false);
	});

	it("resets the failure count after a success", () => {
		const breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 });
		for (let i = 0; i < 4; i += 1) {
			breaker.recordFailure();
		}
		breaker.recordSuccess();
		expect(breaker.isOpen()).toBe(false);
		for (let i = 0; i < 4; i += 1) {
			breaker.recordFailure();
		}
		expect(breaker.isOpen()).toBe(false);
	});

	it("closes the circuit after a successful half-open probe", () => {
		const breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 0 });
		for (let i = 0; i < 5; i += 1) {
			breaker.recordFailure();
		}
		// openMs=0 -> the circuit is immediately half-open and allows one probe
		expect(breaker.isOpen()).toBe(false);
		expect(breaker.canAttempt()).toBe(true);
		breaker.recordSuccess();
		expect(breaker.isOpen()).toBe(false);
	});

	it("reopens after a transient half-open failure", () => {
		const breaker = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 0 });
		for (let i = 0; i < 5; i += 1) {
			breaker.recordFailure();
		}
		expect(breaker.canAttempt()).toBe(true);
		breaker.recordFailure();
		// A transient half-open failure reopens the circuit (openMs=0 -> half-open again)
		expect(breaker.canAttempt()).toBe(true);
		expect(breaker.isOpen()).toBe(false);
	});

	it("maintains independent state per provider", () => {
		const assemblyai = new CircuitBreaker({
			failureThreshold: 5,
			windowMs: 60_000,
			openMs: 30_000,
		});
		const mux = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 });
		for (let i = 0; i < 5; i += 1) {
			assemblyai.recordFailure();
		}
		expect(assemblyai.isOpen()).toBe(true);
		expect(mux.isOpen()).toBe(false);
	});
});
