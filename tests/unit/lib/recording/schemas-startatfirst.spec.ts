// ---------------------------------------------------------------------------
// Unit Tests: ChapterPlaybackRequestSchema startAtFirst Extension (Spec 011)
// Task: T002 — Validates the new optional startAtFirst boolean field.
// ---------------------------------------------------------------------------

import { ChapterPlaybackRequestSchema } from "@/lib/recording/schemas";
import { describe, expect, it } from "vitest";

describe("ChapterPlaybackRequestSchema startAtFirst (T002)", () => {
	it("accepts startAtFirst: true", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			startAtFirst: true,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.startAtFirst).toBe(true);
		}
	});

	it("accepts startAtFirst: false", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			startAtFirst: false,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.startAtFirst).toBe(false);
		}
	});

	it("defaults startAtFirst to false when omitted", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.startAtFirst).toBe(false);
		}
	});

	it("rejects non-boolean startAtFirst value", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			startAtFirst: "yes",
		});
		expect(result.success).toBe(false);
	});

	it("accepts both chapterId and startAtFirst present (chapterId takes precedence at route level)", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			chapterId: 1,
			startAtFirst: true,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.chapterId).toBe(1);
			expect(result.data.startAtFirst).toBe(true);
		}
	});

	it("accepts chapterId without startAtFirst (Spec 010 backward compatible)", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "rec_2026-07-13T10-30-00Z",
			chapterId: 0,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.chapterId).toBe(0);
			expect(result.data.startAtFirst).toBe(false);
		}
	});

	it("rejects empty recordingId", () => {
		const result = ChapterPlaybackRequestSchema.safeParse({
			recordingId: "",
			startAtFirst: true,
		});
		expect(result.success).toBe(false);
	});
});
