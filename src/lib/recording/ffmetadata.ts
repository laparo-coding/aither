// ---------------------------------------------------------------------------
// FFMetadata Chapter Logic (Spec 009)
// Task: T012 — Pure functions for offset computation, chapter creation,
//               appending, and monotonicity validation.
// ---------------------------------------------------------------------------

import type { FFMetadataChapter, FFMetadataJSON } from "./types";

// ── Types ──────────────────────────────────────────────────────────────────

export type FFMetadataError =
	| { kind: "INVALID_TIMESTAMP"; message: string }
	| { kind: "INVALID_REQUEST"; message: string };

export type AppendResult =
	| { ok: true; doc: FFMetadataJSON; chapterId: number; isRetry: boolean }
	| { ok: false; error: FFMetadataError };

// ── Offset Computation ────────────────────────────────────────────────────

/**
 * Compute the offset in microseconds from the recording start to the received timestamp.
 *
 * @param startedAtIso - ISO string of recording start (from session.startedAt)
 * @param timestampUnixSeconds - Unix epoch in seconds (from the request body)
 * @returns Offset in microseconds (non-negative integer)
 */
export function computeOffsetMicros(startedAtIso: string, timestampUnixSeconds: number): number {
	const startMs = new Date(startedAtIso).getTime();
	const startSec = Math.floor(startMs / 1000);
	return (timestampUnixSeconds - startSec) * 1_000_000;
}

// ── Document Creation ──────────────────────────────────────────────────────

/**
 * Create a new ffmetadata document with a single chapter at the given offset.
 * The first chapter's start = the first timestamp offset (not 0).
 */
export function createDocument(assetId: string, offsetMicros: number): FFMetadataJSON {
	return {
		metadata: {
			title: assetId,
			encoder: "aither-ffmetadata",
		},
		chapters: [
			{
				id: 0,
				start: offsetMicros,
				end: offsetMicros, // zero-length placeholder
				title: "Chapter 1",
			},
		],
	};
}

// ── Chapter Append ─────────────────────────────────────────────────────────

/**
 * Append a new chapter to an existing ffmetadata document.
 *
 * Rules:
 * - If offset == last chapter's start → idempotent retry (FR-022): no new chapter.
 * - If offset <= last chapter's start (but not equal) → INVALID_TIMESTAMP (FR-012a).
 * - Otherwise: set last chapter's end to the new offset, append new chapter.
 *
 * @returns AppendResult with the updated doc and chapter id, or an error.
 */
export function appendChapter(doc: FFMetadataJSON, offsetMicros: number): AppendResult {
	if (doc.chapters.length === 0) {
		return {
			ok: false,
			error: { kind: "INVALID_REQUEST", message: "Empty chapters array" },
		};
	}

	const lastChapter = doc.chapters[doc.chapters.length - 1];

	// Idempotent retry: offset equals last chapter's start (FR-022)
	if (offsetMicros === lastChapter.start) {
		return {
			ok: true,
			doc,
			chapterId: lastChapter.id,
			isRetry: true,
		};
	}

	// Non-monotonic: offset is less than or equal to last chapter's start (FR-012a)
	if (offsetMicros <= lastChapter.start) {
		return {
			ok: false,
			error: {
				kind: "INVALID_TIMESTAMP",
				message: "Timestamp must be strictly increasing relative to the last chapter",
			},
		};
	}

	// Close the previous chapter and append a new one
	const newChapter: FFMetadataChapter = {
		id: lastChapter.id + 1,
		start: offsetMicros,
		end: offsetMicros, // zero-length placeholder
		title: `Chapter ${lastChapter.id + 2}`, // 1-indexed title
	};

	const updatedDoc: FFMetadataJSON = {
		...doc,
		chapters: [...doc.chapters.slice(0, -1), { ...lastChapter, end: offsetMicros }, newChapter],
	};

	return {
		ok: true,
		doc: updatedDoc,
		chapterId: newChapter.id,
		isRetry: false,
	};
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate that a timestamp offset is a safe, finite, non-negative integer.
 * Rejects negative, non-integer, unsafe (beyond Number.MAX_SAFE_INTEGER),
 * infinite, and NaN values.
 * @returns null if valid, or an FFMetadataError if invalid.
 */
export function validateOffset(offsetMicros: number): FFMetadataError | null {
	if (
		!Number.isFinite(offsetMicros) ||
		!Number.isInteger(offsetMicros) ||
		offsetMicros < 0 ||
		offsetMicros > Number.MAX_SAFE_INTEGER
	) {
		return {
			kind: "INVALID_TIMESTAMP",
			message: "Timestamp predates recording start",
		};
	}
	return null;
}
