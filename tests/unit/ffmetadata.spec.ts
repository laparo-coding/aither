// ---------------------------------------------------------------------------
// Unit Tests: FFMetadata Pure Logic (Spec 009)
// Task: T006 — offset computation, chapter creation, append/link,
//               monotonicity guard, pre-start rejection.
// ---------------------------------------------------------------------------

import {
	appendChapter,
	computeOffsetMicros,
	createDocument,
	validateOffset,
} from "@/lib/recording/ffmetadata";
import type { FFMetadataJSON } from "@/lib/recording/types";
import { describe, expect, it } from "vitest";

const STARTED_AT = "2026-07-13T10:30:00.000Z";
const START_UNIX = Math.floor(new Date(STARTED_AT).getTime() / 1000);

describe("computeOffsetMicros", () => {
	it("computes offset in microseconds relative to recording start", () => {
		const offset = computeOffsetMicros(STARTED_AT, START_UNIX + 5);
		expect(offset).toBe(5_000_000);
	});

	it("returns 0 when timestamp equals recording start", () => {
		const offset = computeOffsetMicros(STARTED_AT, START_UNIX);
		expect(offset).toBe(0);
	});

	it("returns negative when timestamp predates recording start", () => {
		const offset = computeOffsetMicros(STARTED_AT, START_UNIX - 1);
		expect(offset).toBe(-1_000_000);
	});
});

describe("createDocument", () => {
	it("creates a document with one chapter at the given offset", () => {
		const doc = createDocument("rec_test", 5_000_000);
		expect(doc.metadata.title).toBe("rec_test");
		expect(doc.metadata.encoder).toBe("aither-ffmetadata");
		expect(doc.chapters).toHaveLength(1);
		expect(doc.chapters[0]).toEqual({
			id: 0,
			start: 5_000_000,
			end: 5_000_000,
			title: "Chapter 1",
		});
	});

	it("creates a chapter with start=0 when offset is 0", () => {
		const doc = createDocument("rec_test", 0);
		expect(doc.chapters[0].start).toBe(0);
	});
});

describe("appendChapter", () => {
	it("appends a new chapter and closes the previous chapter's end", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [{ id: 0, start: 5_000_000, end: 5_000_000, title: "Chapter 1" }],
		};

		const result = appendChapter(doc, 20_000_000);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.doc.chapters).toHaveLength(2);
			expect(result.doc.chapters[0].end).toBe(20_000_000); // previous chapter closed
			expect(result.doc.chapters[1]).toEqual({
				id: 1,
				start: 20_000_000,
				end: 20_000_000,
				title: "Chapter 2",
			});
			expect(result.chapterId).toBe(1);
			expect(result.isRetry).toBe(false);
		}
	});

	it("returns idempotent retry when offset equals last chapter start (FR-022)", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [
				{ id: 0, start: 5_000_000, end: 20_000_000, title: "Chapter 1" },
				{ id: 1, start: 20_000_000, end: 20_000_000, title: "Chapter 2" },
			],
		};

		const result = appendChapter(doc, 20_000_000);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.isRetry).toBe(true);
			expect(result.chapterId).toBe(1); // existing chapter
			expect(result.doc.chapters).toHaveLength(2); // no new chapter
		}
	});

	it("rejects non-monotonic timestamp (offset < last chapter start) with INVALID_TIMESTAMP", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [
				{ id: 0, start: 5_000_000, end: 20_000_000, title: "Chapter 1" },
				{ id: 1, start: 20_000_000, end: 20_000_000, title: "Chapter 2" },
			],
		};

		const result = appendChapter(doc, 15_000_000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("INVALID_TIMESTAMP");
		}
	});

	it("chains ≥ 3 timestamps correctly", () => {
		let doc = createDocument("rec_test", 5_000_000);

		const r1 = appendChapter(doc, 20_000_000);
		expect(r1.ok).toBe(true);
		if (r1.ok) doc = r1.doc;

		const r2 = appendChapter(doc, 35_000_000);
		expect(r2.ok).toBe(true);
		if (r2.ok) doc = r2.doc;

		expect(doc.chapters).toHaveLength(3);
		expect(doc.chapters[0].end).toBe(20_000_000);
		expect(doc.chapters[1].end).toBe(35_000_000);
		expect(doc.chapters[2].end).toBe(35_000_000); // last chapter placeholder
	});

	it("rejects empty chapters array with INVALID_REQUEST", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [],
		};

		const result = appendChapter(doc, 5_000_000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("INVALID_REQUEST");
		}
	});
});

describe("validateOffset", () => {
	it("returns null for non-negative offset", () => {
		expect(validateOffset(0)).toBeNull();
		expect(validateOffset(5_000_000)).toBeNull();
	});

	it("returns INVALID_TIMESTAMP for negative offset", () => {
		const error = validateOffset(-1);
		expect(error).not.toBeNull();
		expect(error?.kind).toBe("INVALID_TIMESTAMP");
	});
});
