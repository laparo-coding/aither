// ---------------------------------------------------------------------------
// Unit Tests: Chapter Extractor (Spec 010)
// Task: T023 — ffprobe JSON parsing, timebase conversion (micros → seconds),
//               chapter count cross-check.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractChapters } from "@/lib/recording/chapter-extractor";
import { RemuxFailedError } from "@/lib/recording/ffmpeg-remux";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("node:util", () => ({
	promisify:
		() =>
		(...args: unknown[]) =>
			new Promise((resolve, reject) => {
				mockExecFile(...args, (err: Error | null, result: { stdout: string }) => {
					if (err) reject(err);
					else resolve(result);
				});
			}),
}));

beforeEach(() => {
	mockExecFile.mockReset();
});

describe("extractChapters (T023)", () => {
	it("parses ffprobe JSON and converts microseconds to seconds", async () => {
		const ffprobeOutput = {
			chapters: [
				{
					id: 0,
					time_base: "1/1000000",
					start: 5_000_000,
					end: 20_000_000,
					tags: { title: "Chapter 1" },
				},
				{
					id: 1,
					time_base: "1/1000000",
					start: 20_000_000,
					end: 45_000_000,
					tags: { title: "Chapter 2" },
				},
			],
		};
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, result: { stdout: string }) => void,
			) => {
				cb(null, { stdout: JSON.stringify(ffprobeOutput) });
			},
		);

		const result = await extractChapters("rec_test", "https://stream.mux.com/test.mp4");
		expect(result.assetId).toBe("rec_test");
		expect(result.chapters).toHaveLength(2);
		expect(result.chapters[0]).toEqual({
			id: 0,
			start: 5.0,
			end: 20.0,
			title: "Chapter 1",
		});
		expect(result.chapters[1]).toEqual({
			id: 1,
			start: 20.0,
			end: 45.0,
			title: "Chapter 2",
		});
	});

	it("handles millisecond timebase (1/1000) correctly", async () => {
		const ffprobeOutput = {
			chapters: [
				{
					id: 0,
					time_base: "1/1000",
					start: 5000,
					end: 20000,
					tags: { title: "Chapter 1" },
				},
			],
		};
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, result: { stdout: string }) => void,
			) => {
				cb(null, { stdout: JSON.stringify(ffprobeOutput) });
			},
		);

		const result = await extractChapters("rec_test", "https://stream.mux.com/test.mp4");
		expect(result.chapters[0].start).toBe(5.0);
		expect(result.chapters[0].end).toBe(20.0);
	});

	it("provides default title when tags.title is missing", async () => {
		const ffprobeOutput = {
			chapters: [
				{
					id: 0,
					time_base: "1/1000000",
					start: 0,
					end: 10_000_000,
				},
			],
		};
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, result: { stdout: string }) => void,
			) => {
				cb(null, { stdout: JSON.stringify(ffprobeOutput) });
			},
		);

		const result = await extractChapters("rec_test", "https://stream.mux.com/test.mp4");
		expect(result.chapters[0].title).toBe("Chapter 1");
	});

	it("throws RemuxFailedError when ffprobe fails", async () => {
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, _result: { stdout: string }) => void,
			) => {
				cb(new Error("ffprobe not found"), { stdout: "" });
			},
		);

		await expect(
			extractChapters("rec_test", "https://stream.mux.com/test.mp4"),
		).rejects.toBeInstanceOf(RemuxFailedError);
	});

	it("throws RemuxFailedError when no chapters are found", async () => {
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, result: { stdout: string }) => void,
			) => {
				cb(null, { stdout: JSON.stringify({ chapters: [] }) });
			},
		);

		await expect(
			extractChapters("rec_test", "https://stream.mux.com/test.mp4"),
		).rejects.toBeInstanceOf(RemuxFailedError);
	});

	it("throws RemuxFailedError when ffprobe returns invalid JSON", async () => {
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, result: { stdout: string }) => void,
			) => {
				cb(null, { stdout: "not json" });
			},
		);

		await expect(
			extractChapters("rec_test", "https://stream.mux.com/test.mp4"),
		).rejects.toBeInstanceOf(RemuxFailedError);
	});
});
