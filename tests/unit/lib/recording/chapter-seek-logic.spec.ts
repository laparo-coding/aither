// ---------------------------------------------------------------------------
// Unit Tests: Chapter Seek Logic (Spec 011)
// Task: T001 — nextTimestamp pure function (mirrors Gaia ChapterSeekLogicTests)
// ---------------------------------------------------------------------------

import { nextTimestamp } from "@/lib/recording/chapter-seek-logic";
import type { ChapterSummary } from "@/lib/recording/types";
import { describe, expect, it } from "vitest";

function makeChapter(
	id: number,
	start: number,
	end: number,
	title = `Chapter ${id + 1}`,
): ChapterSummary {
	return { id, start, end, title };
}

describe("nextTimestamp (T001)", () => {
	it("returns first chapter with start greater than current position (mid-chapter)", () => {
		const chapters = [
			makeChapter(0, 5.0, 20.0),
			makeChapter(1, 20.0, 45.0),
			makeChapter(2, 45.0, 90.0),
		];

		// Position 12.0 is inside chapter 0 → next is chapter 1.
		const next = nextTimestamp(chapters, 12.0);
		expect(next).toBeDefined();
		expect(next?.id).toBe(1);
		expect(next?.start).toBe(20.0);
	});

	it("returns next chapter when paused just before next chapter start (at boundary)", () => {
		const chapters = [makeChapter(0, 5.0, 20.0), makeChapter(1, 20.0, 45.0)];

		// Paused just before chapter 1 start (19.999) → next is chapter 1.
		const next = nextTimestamp(chapters, 19.999);
		expect(next).toBeDefined();
		expect(next?.id).toBe(1);
	});

	it("returns null when position is inside the last chapter (in last chapter)", () => {
		const chapters = [makeChapter(0, 5.0, 20.0), makeChapter(1, 20.0, 45.0)];

		// Position 30.0 is inside the last chapter → no next chapter.
		expect(nextTimestamp(chapters, 30.0)).toBeNull();
	});

	it("returns null when position is past the last chapter (past last chapter)", () => {
		const chapters = [makeChapter(0, 5.0, 20.0), makeChapter(1, 20.0, 45.0)];

		// Position 100.0 is past the last chapter → no next chapter.
		expect(nextTimestamp(chapters, 100.0)).toBeNull();
	});

	it("returns null for empty chapters array", () => {
		expect(nextTimestamp([], 0.0)).toBeNull();
	});

	it("returns null for a single chapter (never a next chapter)", () => {
		const chapters = [makeChapter(0, 0.0, 60.0, "Only Chapter")];

		expect(nextTimestamp(chapters, 10.0)).toBeNull();
		expect(nextTimestamp(chapters, 0.0)).toBeNull();
	});

	it("returns first chapter when position is before the first chapter start", () => {
		const chapters = [makeChapter(0, 5.0, 20.0), makeChapter(1, 20.0, 45.0)];

		// Position 0.0 is before the first chapter start (5.0) → next is chapter 0.
		const next = nextTimestamp(chapters, 0.0);
		expect(next).toBeDefined();
		expect(next?.id).toBe(0);
		expect(next?.start).toBe(5.0);
	});

	it("returns null when position equals a chapter start exactly (strict greater-than)", () => {
		const chapters = [makeChapter(0, 5.0, 20.0), makeChapter(1, 20.0, 45.0)];

		// At exactly 20.0 (chapter 1 start), no chapter has start > 20.0 → null.
		expect(nextTimestamp(chapters, 20.0)).toBeNull();
	});
});
