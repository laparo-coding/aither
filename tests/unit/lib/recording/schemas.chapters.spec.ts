// ---------------------------------------------------------------------------
// Unit Tests: Chapter Schemas (Spec 010)
// Task: T003 — ChapterSummarySchema, ChapterListResponseSchema,
//               ChapterRegenerationResultSchema, ChapterPlaybackRequestSchema,
//               ChapterPlaybackResultSchema, ChapterBoundaryEventSchema
// ---------------------------------------------------------------------------

import {
	ChapterBoundaryEventSchema,
	ChapterListResponseSchema,
	ChapterPlaybackRequestSchema,
	ChapterPlaybackResultSchema,
	ChapterRegenerationResultSchema,
	ChapterSummarySchema,
} from "@/lib/recording/schemas";
import { describe, expect, it } from "vitest";

describe("ChapterSummarySchema", () => {
	it("accepts a valid chapter with end > start", () => {
		const result = ChapterSummarySchema.safeParse({
			id: 0,
			start: 5.0,
			end: 20.0,
			title: "Chapter 1",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a chapter with end <= start", () => {
		const result = ChapterSummarySchema.safeParse({
			id: 0,
			start: 20.0,
			end: 20.0,
			title: "Chapter 1",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a chapter with empty title", () => {
		const result = ChapterSummarySchema.safeParse({
			id: 0,
			start: 5.0,
			end: 20.0,
			title: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a chapter with negative id", () => {
		const result = ChapterSummarySchema.safeParse({
			id: -1,
			start: 5.0,
			end: 20.0,
			title: "Chapter 1",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a chapter with negative start", () => {
		const result = ChapterSummarySchema.safeParse({
			id: 0,
			start: -1,
			end: 20.0,
			title: "Chapter 1",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a title longer than 255 characters", () => {
		const result = ChapterSummarySchema.safeParse({
			id: 0,
			start: 5.0,
			end: 20.0,
			title: "x".repeat(256),
		});
		expect(result.success).toBe(false);
	});
});

describe("ChapterListResponseSchema", () => {
	it("accepts a valid chapter list with at least one chapter", () => {
		const result = ChapterListResponseSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			chapters: [
				{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" },
				{ id: 1, start: 20.0, end: 45.0, title: "Chapter 2" },
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects an empty chapters array", () => {
		const result = ChapterListResponseSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			chapters: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects an empty assetId", () => {
		const result = ChapterListResponseSchema.safeParse({
			assetId: "",
			chapters: [{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-continuous chapter ids", () => {
		const result = ChapterListResponseSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			chapters: [
				{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" },
				{ id: 2, start: 20.0, end: 45.0, title: "Chapter 2" },
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects overlapping chapters", () => {
		const result = ChapterListResponseSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			chapters: [
				{ id: 0, start: 5.0, end: 25.0, title: "Chapter 1" },
				{ id: 1, start: 20.0, end: 45.0, title: "Chapter 2" },
			],
		});
		expect(result.success).toBe(false);
	});
});

describe("ChapterRegenerationResultSchema", () => {
	it("accepts a valid regeneration result with muxAssetId", () => {
		const result = ChapterRegenerationResultSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
			chapterCount: 5,
		});
		expect(result.success).toBe(true);
	});

	it("rejects a result with empty muxAssetId", () => {
		const result = ChapterRegenerationResultSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			muxAssetId: "",
			chapterCount: 5,
		});
		expect(result.success).toBe(false);
	});

	it("rejects a result with chapterCount < 1", () => {
		const result = ChapterRegenerationResultSchema.safeParse({
			assetId: "rec_2026-07-13T10-30-00Z",
			muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
			chapterCount: 0,
		});
		expect(result.success).toBe(false);
	});
});

describe("ChapterPlaybackRequestSchema", () => {
	it("accepts a request with recordingId only (backward compatible)", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
		});
		expect(result.success).toBe(true);
	});

	it("accepts a request with recordingId and chapterId", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			chapterId: 1,
		});
		expect(result.success).toBe(true);
	});

	it("rejects a request without recordingId", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			chapterId: 1,
		});
		expect(result.success).toBe(false);
	});

	it("rejects a negative chapterId", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			chapterId: -1,
		});
		expect(result.success).toBe(false);
	});
});

describe("ChapterPlaybackResultSchema", () => {
	it("accepts a result with accepted=true and chapter fields", () => {
		const result = ChapterPlaybackResultSchema.safeParse({
			accepted: true,
			chapterId: 1,
			start: 20.0,
			end: 45.0,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a result with accepted=true and no chapter fields", () => {
		const result = ChapterPlaybackResultSchema.safeParse({
			accepted: true,
		});
		expect(result.success).toBe(true);
	});

	it("rejects a result with accepted=false", () => {
		const result = ChapterPlaybackResultSchema.safeParse({
			accepted: false,
		});
		expect(result.success).toBe(false);
	});

	it("rejects a result with end <= start when both provided", () => {
		const result = ChapterPlaybackResultSchema.safeParse({
			accepted: true,
			chapterId: 1,
			start: 45.0,
			end: 20.0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects partial chapter playback details", () => {
		const result = ChapterPlaybackResultSchema.safeParse({
			accepted: true,
			chapterId: 1,
			start: 20.0,
		});
		expect(result.success).toBe(false);
	});
});

describe("ChapterBoundaryEventSchema", () => {
	it("accepts a valid boundary event with nextChapterId", () => {
		const result = ChapterBoundaryEventSchema.safeParse({
			chapterId: 1,
			nextChapterId: 2,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a boundary event without nextChapterId (final chapter)", () => {
		const result = ChapterBoundaryEventSchema.safeParse({
			chapterId: 5,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a boundary event with timestamp", () => {
		const result = ChapterBoundaryEventSchema.safeParse({
			chapterId: 1,
			nextChapterId: 2,
			timestamp: 1234567890,
		});
		expect(result.success).toBe(true);
	});

	it("rejects an event without chapterId", () => {
		const result = ChapterBoundaryEventSchema.safeParse({
			nextChapterId: 2,
		});
		expect(result.success).toBe(false);
	});

	it("rejects an event with negative chapterId", () => {
		const result = ChapterBoundaryEventSchema.safeParse({
			chapterId: -1,
		});
		expect(result.success).toBe(false);
	});
});
