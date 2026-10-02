// ---------------------------------------------------------------------------
// Transcript Formatter
// Task: T014 — Renders the role-separated transcript document from mapped
// utterances. Preserves order/timestamps, keeps overlapping utterances
// separate, and rejects missing/unmapped speaker IDs.
// ---------------------------------------------------------------------------

import { type TranscriptLine, buildTranscriptDocument } from "@/lib/recording/transcript-blob";
import type { SeminarRole } from "./types";

export interface MappedUtterance {
	speakerId: string;
	role: SeminarRole;
	text: string;
	startMs: number;
}

/**
 * Formats mapped utterances into the final UTF-8 transcript document.
 * Throws when an utterance carries an unmapped or missing speaker ID.
 */
export function formatTranscript(utterances: MappedUtterance[]): string {
	const lines: TranscriptLine[] = utterances.map((u) => {
		if (!u.speakerId || !u.role) {
			throw new Error("TRANSCRIPT_MAPPING_INVALID: utterance has no speaker ID or role");
		}
		return { role: u.role, text: u.text, startMs: u.startMs };
	});
	return buildTranscriptDocument(lines);
}
