// ---------------------------------------------------------------------------
// Contract Tests: Chapters Endpoint Foundation (Spec 010)
// Task: T001 — Request/response envelope skeleton for
//               POST /api/recording/chapters/[id] and
//               GET /api/recording/chapters/[id]
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
	ChapterListResponseSchema,
	ChapterRegenerationResultSchema,
} from "@/lib/recording/schemas";

describe("POST /api/recording/chapters/[id] — contract envelope", () => {
	it("defines a valid 200 ChapterRegenerationResult shape with muxAssetId", () => {
		const sample = {
			assetId: "rec_2026-07-13T10-30-00Z",
			muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
			chapterCount: 5,
		};
		expect(ChapterRegenerationResultSchema.safeParse(sample).success).toBe(true);
	});

	it("defines a valid 404 error envelope shape", () => {
		const notFound = {
			success: false,
			error: { code: "FFMETADATA_NOT_FOUND", message: "No ffmetadata JSON blob found for assetId" },
		};
		expect(notFound.success).toBe(false);
		expect(notFound.error.code).toBe("FFMETADATA_NOT_FOUND");
	});

	it("defines a valid 409 error envelope shape", () => {
		const conflict = {
			success: false,
			error: {
				code: "RECORDING_IN_PROGRESS",
				message: "Cannot regenerate while recording is still active",
			},
		};
		expect(conflict.error.code).toBe("RECORDING_IN_PROGRESS");
	});

	it("defines a valid 422 error envelope shape", () => {
		const invalid = {
			success: false,
			error: { code: "FFMETADATA_INVALID", message: "ffmetadata JSON failed schema validation" },
		};
		expect(invalid.error.code).toBe("FFMETADATA_INVALID");
	});

	it("defines a valid 502 error envelope shape", () => {
		const remuxFailed = {
			success: false,
			error: { code: "REMUX_FAILED", message: "FFmpeg remux failed or chapter validation failed" },
		};
		expect(remuxFailed.error.code).toBe("REMUX_FAILED");
	});

	it("defines a valid 503 error envelope shape", () => {
		const storageDown = {
			success: false,
			error: {
				code: "BLOB_STORAGE_UNAVAILABLE",
				message: "Vercel Blob Storage temporarily unavailable",
			},
		};
		expect(storageDown.error.code).toBe("BLOB_STORAGE_UNAVAILABLE");
	});
});

describe("GET /api/recording/chapters/[id] — contract envelope", () => {
	it("defines a valid 200 ChapterListResponse shape with seconds-based chapters", () => {
		const sample = {
			assetId: "rec_2026-07-13T10-30-00Z",
			chapters: [
				{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" },
				{ id: 1, start: 20.0, end: 45.0, title: "Chapter 2" },
			],
		};
		expect(ChapterListResponseSchema.safeParse(sample).success).toBe(true);
	});

	it("defines a valid 404 CHAPTERS_NOT_GENERATED error envelope shape", () => {
		const notGenerated = {
			success: false,
			error: {
				code: "CHAPTERS_NOT_GENERATED",
				message: "Chaptered video has not been generated yet",
			},
		};
		expect(notGenerated.error.code).toBe("CHAPTERS_NOT_GENERATED");
	});
});
