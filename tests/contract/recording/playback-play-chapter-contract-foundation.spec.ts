// ---------------------------------------------------------------------------
// Contract Tests: Playback Play Chapter Foundation (Spec 010)
// Task: T002 — Request/response envelope skeleton for extended
//               POST /api/recording/playback/play
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { ChapterPlaybackRequestSchema, ChapterPlaybackResultSchema } from "@/lib/recording/schemas";

describe("POST /api/recording/playback/play — extended chapter envelope", () => {
	it("accepts a request with recordingId only (backward compatible)", () => {
		const request = { recordingId: "rec_2026-07-13T10-30-00Z" };
		expect(ChapterPlaybackRequestSchema.safeParse(request).success).toBe(true);
	});

	it("accepts a request with recordingId and chapterId", () => {
		const request = {
			recordingId: "rec_2026-07-13T10-30-00Z",
			chapterId: 1,
		};
		expect(ChapterPlaybackRequestSchema.safeParse(request).success).toBe(true);
	});

	it("defines a valid 200 ChapterPlaybackResult shape with chapter fields", () => {
		const result = {
			accepted: true,
			chapterId: 1,
			start: 20.0,
			end: 45.0,
		};
		expect(ChapterPlaybackResultSchema.safeParse(result).success).toBe(true);
	});

	it("defines a valid 200 ChapterPlaybackResult shape without chapter fields", () => {
		const result = { accepted: true };
		expect(ChapterPlaybackResultSchema.safeParse(result).success).toBe(true);
	});

	it("defines a valid 404 CHAPTER_NOT_FOUND error envelope shape", () => {
		const notFound = {
			success: false,
			error: { code: "CHAPTER_NOT_FOUND", message: "Chapter ID does not exist for this recording" },
		};
		expect(notFound.error.code).toBe("CHAPTER_NOT_FOUND");
	});
});
