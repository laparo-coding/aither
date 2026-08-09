// ---------------------------------------------------------------------------
// Chapter Seek Logic (Spec 011)
// Task: T003 — Pure nextTimestamp function (mirrors Gaia ChapterSeekLogic).
//               Returns the first chapter whose `start` is strictly greater
//               than the current playback position, or null if none exists.
//               Pure, side-effect-free, fully deterministic — no player, UI,
//               or network dependencies.
// ---------------------------------------------------------------------------

import type { ChapterSummary } from "./types";

/**
 * Returns the next chapter to seek to, given the loaded chapter list and the
 * current playback position (in seconds).
 *
 * The next chapter is the first chapter whose `start` is strictly greater than
 * `currentPosition`. Returns `null` when the position is within or past the
 * last chapter, when chapters are empty, or when only a single chapter exists.
 *
 * This is a direct port of Gaia's `ChapterSeekLogic.nextChapter` (Spec 010,
 * FR-002 + FR-004) to TypeScript.
 *
 * @param chapters - Ordered list of chapter summaries (may be empty).
 * @param currentPosition - Current playback position in seconds.
 * @returns The next chapter to seek to, or `null` if in/past the last chapter.
 */
export function nextTimestamp(
	chapters: ChapterSummary[],
	currentPosition: number,
): ChapterSummary | null {
	return chapters.find((c) => c.start > currentPosition) ?? null;
}
