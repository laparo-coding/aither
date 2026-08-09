// ---------------------------------------------------------------------------
// Unit Tests: File Manager
// Task: T017 [P] [US2] — List files matching rec_*.mp4, parse filename to
//                         ID/timestamp, get file size, get duration via
//                         ffprobe mock, delete file, empty dir, invalid
//                         files ignored
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock config
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		RECORDINGS_OUTPUT_DIR: "output/recordings",
	}),
}));

// Mock fs/promises
const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockUnlink = vi.fn();

vi.mock("node:fs/promises", () => ({
	readdir: (...args: unknown[]) => mockReaddir(...args),
	stat: (...args: unknown[]) => mockStat(...args),
	unlink: (...args: unknown[]) => mockUnlink(...args),
}));

// Mock child_process (for ffprobe via execFile)
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => {
		// promisify wraps this, so we handle the callback style
		// nosemgrep: javascript.lang.security.audit.dynamic-module-access
		const cb = args[args.length - 1];
		if (typeof cb === "function") {
			const result = mockExecFile(...args.slice(0, -1));
			if (result instanceof Error) {
				cb(result, "", "");
			} else {
				cb(null, result?.stdout ?? "0", "");
			}
		}
		return { on: vi.fn() };
	},
}));

describe("File Manager", () => {
	let fileManager: typeof import("@/lib/recording/file-manager");

	beforeEach(async () => {
		vi.clearAllMocks();
		fileManager = await import("@/lib/recording/file-manager");
	});

	describe("parseFilename", () => {
		it("parses a valid recording filename", () => {
			const result = fileManager.parseFilename("rec_2025-01-15T10-30-00Z.mp4");
			expect(result).toEqual({
				id: "rec_2025-01-15T10-30-00Z",
				createdAt: "2025-01-15T10:30:00Z",
			});
		});

		it("returns null for invalid filename", () => {
			expect(fileManager.parseFilename("video.mp4")).toBeNull();
			expect(fileManager.parseFilename("rec_invalid.mp4")).toBeNull();
			expect(fileManager.parseFilename("rec_2025-01-15T10-30-00Z.avi")).toBeNull();
		});

		it("returns null for empty string", () => {
			expect(fileManager.parseFilename("")).toBeNull();
		});
	});

	describe("listRecordings", () => {
		it("lists valid recordings sorted by date descending", async () => {
			mockReaddir.mockResolvedValue([
				"rec_2025-01-15T10-30-00Z.mp4",
				"rec_2025-01-16T14-00-00Z.mp4",
			]);
			mockStat.mockResolvedValue({ size: 1024000, isFile: () => true });
			mockExecFile.mockReturnValue({ stdout: "120.5" });

			const recordings = await fileManager.listRecordings();

			expect(recordings).toHaveLength(2);
			// Newest first
			expect(recordings[0].id).toBe("rec_2025-01-16T14-00-00Z");
			expect(recordings[1].id).toBe("rec_2025-01-15T10-30-00Z");
			expect(recordings[0].fileSize).toBe(1024000);
		});

		it("returns empty array when directory does not exist", async () => {
			mockReaddir.mockRejectedValue(new Error("ENOENT"));

			const recordings = await fileManager.listRecordings();
			expect(recordings).toEqual([]);
		});

		it("ignores files that do not match the pattern", async () => {
			mockReaddir.mockResolvedValue([
				"rec_2025-01-15T10-30-00Z.mp4",
				"notes.txt",
				".DS_Store",
				"video.avi",
			]);
			mockStat.mockResolvedValue({ size: 512000, isFile: () => true });
			mockExecFile.mockReturnValue({ stdout: "60.0" });

			const recordings = await fileManager.listRecordings();
			expect(recordings).toHaveLength(1);
			expect(recordings[0].id).toBe("rec_2025-01-15T10-30-00Z");
		});

		it("skips entries that are not files", async () => {
			mockReaddir.mockResolvedValue(["rec_2025-01-15T10-30-00Z.mp4"]);
			mockStat.mockResolvedValue({ size: 0, isFile: () => false });

			const recordings = await fileManager.listRecordings();
			expect(recordings).toHaveLength(0);
		});
	});

	describe("getRecordingById", () => {
		it("returns a recording when found", async () => {
			mockReaddir.mockResolvedValue(["rec_2025-01-15T10-30-00Z.mp4"]);
			mockStat.mockResolvedValue({ size: 1024000, isFile: () => true });
			mockExecFile.mockReturnValue({ stdout: "120.5" });

			const recording = await fileManager.getRecordingById("rec_2025-01-15T10-30-00Z");
			expect(recording).not.toBeNull();
			expect(recording?.id).toBe("rec_2025-01-15T10-30-00Z");
		});

		it("returns null when not found", async () => {
			mockReaddir.mockResolvedValue([]);
			const recording = await fileManager.getRecordingById("rec_9999-01-01T00-00-00Z");
			expect(recording).toBeNull();
		});
	});

	describe("deleteRecording", () => {
		it("deletes a recording and returns true", async () => {
			mockReaddir.mockResolvedValue(["rec_2025-01-15T10-30-00Z.mp4"]);
			mockStat.mockResolvedValue({ size: 1024000, isFile: () => true });
			mockExecFile.mockReturnValue({ stdout: "120.5" });
			mockUnlink.mockResolvedValue(undefined);

			const result = await fileManager.deleteRecording("rec_2025-01-15T10-30-00Z");
			expect(result).toBe(true);
			expect(mockUnlink).toHaveBeenCalledOnce();
		});

		it("returns false when recording not found", async () => {
			mockReaddir.mockResolvedValue([]);
			const result = await fileManager.deleteRecording("rec_nonexistent");
			expect(result).toBe(false);
			expect(mockUnlink).not.toHaveBeenCalled();
		});

		it("returns false when unlink fails", async () => {
			mockReaddir.mockResolvedValue(["rec_2025-01-15T10-30-00Z.mp4"]);
			mockStat.mockResolvedValue({ size: 1024000, isFile: () => true });
			mockExecFile.mockReturnValue({ stdout: "120.5" });
			mockUnlink.mockRejectedValue(new Error("EPERM"));

			const result = await fileManager.deleteRecording("rec_2025-01-15T10-30-00Z");
			expect(result).toBe(false);
		});
	});

	describe("resolveFilePath", () => {
		it("returns the file path for an existing recording", async () => {
			mockReaddir.mockResolvedValue(["rec_2025-01-15T10-30-00Z.mp4"]);
			mockStat.mockResolvedValue({ size: 1024000, isFile: () => true });
			mockExecFile.mockReturnValue({ stdout: "120.5" });

			const path = await fileManager.resolveFilePath("rec_2025-01-15T10-30-00Z");
			expect(path).toContain("rec_2025-01-15T10-30-00Z.mp4");
		});

		it("returns null for non-existent recording", async () => {
			mockReaddir.mockResolvedValue([]);
			const path = await fileManager.resolveFilePath("rec_nonexistent");
			expect(path).toBeNull();
		});
	});
});
