// ---------------------------------------------------------------------------
// Unit Tests: FFmpeg Remux Module (Spec 010)
// Task: T012 — spawn FFmpeg, monitor stderr, handle exit codes, cleanup
// Task: T013 — FFMETADATA1 serialization + final chapter end clamping
// ---------------------------------------------------------------------------

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type RemuxOptions, serializeFFMetadata1 } from "@/lib/recording/ffmpeg-remux";
import type { FFMetadataJSON } from "@/lib/recording/types";

// Mock child_process spawn
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock ffmetadata serializer helpers (we test serializeFFMetadata1 directly)
vi.mock("@/lib/recording/ffmetadata", () => ({
	computeOffsetMicros: vi.fn(),
	createDocument: vi.fn(),
	appendChapter: vi.fn(),
	validateOffset: vi.fn(),
}));

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "ffmpeg-remux-test-"));
	mockSpawn.mockReset();
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("serializeFFMetadata1 (T013)", () => {
	it("serializes a single-chapter ffmetadata JSON to FFMETADATA1 text", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [{ id: 0, start: 5_000_000, end: 7200_000_000, title: "Chapter 1" }],
		};
		const text = serializeFFMetadata1(doc, 7200_000_000);
		expect(text).toContain(";FFMETADATA1");
		expect(text).toContain("[CHAPTER]");
		expect(text).toContain("TIMEBASE=1/1000000");
		expect(text).toContain("START=5000000");
		expect(text).toContain("END=7200000000");
		expect(text).toContain("title=Chapter 1");
	});

	it("clamps the final chapter end to the video duration when placeholder is zero", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [
				{ id: 0, start: 5_000_000, end: 20_000_000, title: "Chapter 1" },
				{ id: 1, start: 20_000_000, end: 0, title: "Chapter 2" },
			],
		};
		const videoDurationMicros = 45_000_000;
		const text = serializeFFMetadata1(doc, videoDurationMicros);
		// Final chapter end should be clamped to video duration
		expect(text).toContain("END=45000000");
		// First chapter end unchanged
		expect(text).toContain("END=20000000");
	});

	it("clamps the final chapter end to video duration when end exceeds duration", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [
				{ id: 0, start: 0, end: 100_000_000, title: "Chapter 1" },
				{ id: 1, start: 100_000_000, end: 200_000_000, title: "Chapter 2" },
			],
		};
		const videoDurationMicros = 150_000_000;
		const text = serializeFFMetadata1(doc, videoDurationMicros);
		// Final chapter end clamped down to video duration
		expect(text).toContain("END=150000000");
	});

	it("emits multiple [CHAPTER] blocks for multi-chapter documents", () => {
		const doc: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [
				{ id: 0, start: 0, end: 10_000_000, title: "A" },
				{ id: 1, start: 10_000_000, end: 20_000_000, title: "B" },
				{ id: 2, start: 20_000_000, end: 30_000_000, title: "C" },
			],
		};
		const text = serializeFFMetadata1(doc, 30_000_000);
		const chapterBlockCount = (text.match(/\[CHAPTER\]/g) ?? []).length;
		expect(chapterBlockCount).toBe(3);
	});
});

describe("remuxWithChapters spawn behavior (T012)", () => {
	it("rejects with RemuxFailedError when FFmpeg exits with non-zero code", async () => {
		const { remuxWithChapters, RemuxFailedError } = await import("@/lib/recording/ffmpeg-remux");
		const rawPath = join(tempDir, "raw.mp4");
		await writeFile(rawPath, "fake");

		const emittedEvents: Array<{ event: string; cb: (...a: unknown[]) => void }> = [];

		mockSpawn.mockImplementation(() => {
			const proc = {
				stderr: {
					on: (event: string, cb: (...a: unknown[]) => void) => {
						emittedEvents.push({ event: `stderr:${event}`, cb });
					},
				},
				on: (event: string, cb: (...a: unknown[]) => void) => {
					emittedEvents.push({ event, cb });
				},
			};
			// Emit close(1) on next tick to simulate non-zero exit
			queueMicrotask(() => {
				const closeEvt = emittedEvents.find((e) => e.event === "close");
				closeEvt?.cb(1);
			});
			return proc;
		});

		const ffmetadataJson: FFMetadataJSON = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
			chapters: [{ id: 0, start: 0, end: 10_000_000, title: "Chapter 1" }],
		};

		const options: RemuxOptions = {
			assetId: "rec_test",
			rawMp4Path: rawPath,
			outputPath: join(tempDir, "out.chapters.mp4"),
			videoDurationMicros: 10_000_000,
		};

		await expect(remuxWithChapters(ffmetadataJson, options)).rejects.toBeInstanceOf(
			RemuxFailedError,
		);
	});
});
