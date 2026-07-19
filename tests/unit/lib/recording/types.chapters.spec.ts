// ---------------------------------------------------------------------------
// Unit Tests: Chapter Types (Compile-Time, Spec 010)
// Task: T004 — Verify inferred TypeScript types match Zod schemas
// ---------------------------------------------------------------------------

import type {
	ChapterBoundaryEvent,
	ChapterListResponse,
	ChapterPlaybackRequest,
	ChapterPlaybackResult,
	ChapterRegenerationResult,
	ChapterSummary,
} from "@/lib/recording/types";
import { describe, expect, it } from "vitest";

describe("Chapter inferred types (compile-time)", () => {
	it("ChapterSummary has required fields with correct types", () => {
		const chapter: ChapterSummary = {
			id: 0,
			start: 5.0,
			end: 20.0,
			title: "Chapter 1",
		};
		expect(chapter.id).toBe(0);
		expect(chapter.start).toBe(5.0);
		expect(chapter.end).toBe(20.0);
		expect(chapter.title).toBe("Chapter 1");
	});

	it("ChapterListResponse contains assetId and chapters array", () => {
		const response: ChapterListResponse = {
			assetId: "rec_2026-07-13T10-30-00Z",
			chapters: [
				{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" },
				{ id: 1, start: 20.0, end: 45.0, title: "Chapter 2" },
			],
		};
		expect(response.assetId).toBe("rec_2026-07-13T10-30-00Z");
		expect(response.chapters).toHaveLength(2);
	});

	it("ChapterRegenerationResult contains muxAssetId (not chaptersFile)", () => {
		const result: ChapterRegenerationResult = {
			assetId: "rec_2026-07-13T10-30-00Z",
			muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
			chapterCount: 5,
		};
		expect(result.muxAssetId).toBe("mux_chapters_rec_2026-07-13T10-30-00Z");
		expect(result.chapterCount).toBe(5);
	});

	it("ChapterPlaybackRequest allows optional chapterId", () => {
		const withoutChapter: ChapterPlaybackRequest = {
			recordingId: "rec_2026-07-13T10-30-00Z",
		};
		const withChapter: ChapterPlaybackRequest = {
			recordingId: "rec_2026-07-13T10-30-00Z",
			chapterId: 1,
		};
		expect(withoutChapter.chapterId).toBeUndefined();
		expect(withChapter.chapterId).toBe(1);
	});

	it("ChapterPlaybackResult allows optional chapter fields", () => {
		const minimal: ChapterPlaybackResult = { accepted: true };
		const full: ChapterPlaybackResult = {
			accepted: true,
			chapterId: 1,
			start: 20.0,
			end: 45.0,
		};
		expect(minimal.accepted).toBe(true);
		expect(full.chapterId).toBe(1);
	});

	it("ChapterBoundaryEvent supports optional nextChapterId and timestamp", () => {
		const finalChapter: ChapterBoundaryEvent = {
			chapterId: 5,
		};
		const midChapter: ChapterBoundaryEvent = {
			chapterId: 1,
			nextChapterId: 2,
			timestamp: 1234567890,
		};
		expect(finalChapter.nextChapterId).toBeUndefined();
		expect(midChapter.nextChapterId).toBe(2);
	});
});
