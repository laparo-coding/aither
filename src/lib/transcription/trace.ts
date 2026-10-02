// ---------------------------------------------------------------------------
// Sanitized Workflow Trace
// Task: T042 [US3] — Builds minimal trace events containing only IDs, status
// transitions, timestamps, and operator identity. Excludes transcript text,
// raw payloads, signed URLs, tokens, and secrets (FR-025).
// ---------------------------------------------------------------------------

import type { TraceEvent } from "./types";

export interface TraceEventInput {
	eventType: string;
	fromStatus?: string | null;
	toStatus?: string | null;
	providerReference?: string | null;
	errorCode?: string | null;
	operatorId?: string | null;
}

/** Keys that must never appear in a trace event (FR-025). */
const FORBIDDEN_KEYS = new Set([
	"transcriptText",
	"transcript",
	"rawPayload",
	"payload",
	"body",
	"signedUrl",
	"url",
	"token",
	"secret",
	"apiKey",
	"authorization",
]);

/**
 * Builds a sanitized trace event. Only the permitted minimal fields are
 * retained; anything else in the input is dropped, never copied.
 */
export function buildTraceEvent(input: TraceEventInput): TraceEvent {
	const event: TraceEvent = {
		eventType: input.eventType,
		fromStatus: input.fromStatus ?? null,
		toStatus: input.toStatus ?? null,
		providerReference: input.providerReference ?? null,
		errorCode: input.errorCode ?? null,
		operatorId: input.operatorId ?? null,
		occurredAt: new Date().toISOString(),
	};

	// Defense in depth: verify no forbidden key leaked into the event
	for (const key of Object.keys(event)) {
		if (FORBIDDEN_KEYS.has(key)) {
			throw new Error(`TRACE_SANITIZATION_VIOLATION: forbidden key "${key}"`);
		}
	}

	return event;
}

/**
 * Builds a sanitized Rollbar report context: IDs, statuses, and error codes
 * only — never transcript text, signed URLs, or provider tokens (FR-025).
 */
export function buildSanitizedErrorContext(params: {
	bookingId: string;
	recordingId: string;
	stage: string;
	errorCode: string;
}): Record<string, string> {
	return {
		bookingId: params.bookingId,
		recordingId: params.recordingId,
		stage: params.stage,
		errorCode: params.errorCode,
	};
}
