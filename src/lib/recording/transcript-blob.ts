// ---------------------------------------------------------------------------
// Private Transcript Blob
// Task: T030 (partial, pure helpers) — UTF-8 role-labelled transcript
// document rendering and the five-minute participant signed GET expiry
// (FR-007/FR-012/FR-029).
// ---------------------------------------------------------------------------

/** Participant transcript signed GET URLs expire after exactly five minutes. */
export const TRANSCRIPT_URL_EXPIRY_SECONDS = 300;

export interface TranscriptLine {
	role: string;
	text: string;
	startMs: number;
}

function formatTimestamp(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const millis = ms % 1000;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/**
 * Renders the final UTF-8 plain-text transcript document:
 * chronological utterances (overlaps kept separate, start-time order),
 * normalized role labels, and timestamps where supplied.
 */
export function buildTranscriptDocument(lines: TranscriptLine[]): string {
	const ordered = [...lines].sort((a, b) => a.startMs - b.startMs);
	return ordered
		.map((line) => `[${formatTimestamp(line.startMs)}] ${line.role}: ${line.text}`)
		.join("\n");
}
