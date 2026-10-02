// ---------------------------------------------------------------------------
// Private Source Staging
// Task: T014a — Deterministic private staging pathname, scoped signed
// provider-read URL issuance, and idempotent source cleanup (FR-019/FR-021).
// Staging objects are never participant-visible.
// ---------------------------------------------------------------------------

/** Deterministic private source-staging pathname for a recording. */
export function buildSourceStagingPathname(bookingId: string, recordingId: string): string {
	return `seminar-sources/${bookingId}/${recordingId}.mp4`;
}

/** Deterministic private final-transcript pathname (distinct from staging). */
export function buildTranscriptPathname(bookingId: string, recordingId: string): string {
	return `seminar-transcripts/${bookingId}/${recordingId}.txt`;
}
