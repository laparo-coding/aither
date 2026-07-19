// ---------------------------------------------------------------------------
// Contract Tests: POST /api/recording/chapters/[id] (Spec 010)
// Task: T010 — Success path (200)
// Task: T011 — Error paths (400, 401, 403, 404 RECORDING_NOT_FOUND,
//               404 FFMETADATA_NOT_FOUND, 409, 422, 502, 503, 500)
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		RECORDINGS_OUTPUT_DIR: "output/recordings",
		MUX_TOKEN_ID: "test-id",
		MUX_TOKEN_SECRET: "test-secret",
	}),
}));

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
	ErrorSeverity: { ERROR: "error", WARNING: "warning", INFO: "info", CRITICAL: "critical" },
}));

// Session manager mock
const mockIsRecording = vi.fn().mockReturnValue(false);
const mockGetSessionState = vi.fn().mockReturnValue(null);

vi.mock("@/lib/recording/session-manager", () => ({
	isRecording: (...args: unknown[]) => mockIsRecording(...args),
	getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
}));

// File manager mock
const mockResolveFilePath = vi
	.fn()
	.mockResolvedValue("output/recordings/rec_2026-07-13T10-30-00Z.mp4");
const mockGetDuration = vi.fn().mockResolvedValue(7200);

vi.mock("@/lib/recording/file-manager", () => ({
	resolveFilePath: (...args: unknown[]) => mockResolveFilePath(...args),
	getDuration: (...args: unknown[]) => mockGetDuration(...args),
}));

// FFMetadata blob mock
const mockReadFFMetadata = vi.fn();

vi.mock("@/lib/recording/ffmetadata-blob", () => ({
	readFFMetadata: (...args: unknown[]) => mockReadFFMetadata(...args),
	BlobStorageError: class BlobStorageError extends Error {
		constructor(message: string) {
			super(`BLOB_STORAGE_UNAVAILABLE: ${message}`);
			this.name = "BlobStorageError";
		}
	},
}));

// FFmpeg remux mock
const mockRemuxWithChapters = vi.fn();

vi.mock("@/lib/recording/ffmpeg-remux", () => ({
	remuxWithChapters: (...args: unknown[]) => mockRemuxWithChapters(...args),
	RemuxFailedError: class RemuxFailedError extends Error {
		exitCode: number | null;
		stderr: string;
		constructor(message: string, exitCode: number | null, stderr: string) {
			super(message);
			this.name = "RemuxFailedError";
			this.exitCode = exitCode;
			this.stderr = stderr;
		}
	},
}));

// MUX uploader mock
const mockUploadToMux = vi.fn().mockResolvedValue({
	muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
	muxPlaybackUrl: "https://stream.mux.com/playback-xyz.mp4",
});

vi.mock("@/lib/recording/mux-uploader", () => ({
	uploadToMux: (...args: unknown[]) => mockUploadToMux(...args),
}));

// fs/promises unlink mock
vi.mock("node:fs/promises", () => ({
	unlink: vi.fn().mockResolvedValue(undefined),
}));

// node:child_process execFile mock (for ffprobe chapter count validation)
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_ASSET_ID = "rec_2026-07-13T10-30-00Z";
const VALID_FFMETADATA = {
	metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
	chapters: [
		{ id: 0, start: 0, end: 20_000_000, title: "Chapter 1" },
		{ id: 1, start: 20_000_000, end: 45_000_000, title: "Chapter 2" },
	],
};

function makeRequest(
	method: string,
	id: string,
	headers: Record<string, string> = {},
): NextRequest {
	const url = `http://localhost:3000/api/recording/chapters/${id}`;
	return new Request(url, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
	}) as NextRequest;
}

function makeAuthedRequest(id: string): NextRequest {
	return makeRequest("POST", id, { Authorization: "Bearer test-token" });
}

// ── Import route after mocks ───────────────────────────────────────────────

import { POST } from "@/app/api/recording/chapters/[id]/route";

// Set URANOS_SYNC_TOKEN so auth passes
beforeEach(() => {
	process.env.URANOS_SYNC_TOKEN = "test-token";
	mockIsRecording.mockReturnValue(false);
	mockGetSessionState.mockReturnValue(null);
	mockResolveFilePath.mockResolvedValue("output/recordings/rec_2026-07-13T10-30-00Z.mp4");
	mockGetDuration.mockResolvedValue(7200);
	mockReadFFMetadata.mockResolvedValue({ doc: VALID_FFMETADATA, corrupt: false });
	mockRemuxWithChapters.mockResolvedValue("output/recordings/out.chapters.mp4");
	mockUploadToMux.mockResolvedValue({
		muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
		muxPlaybackUrl: "https://stream.mux.com/playback-xyz.mp4",
	});
	mockExecFile.mockImplementation(
		(
			_cmd: string,
			_args: string[],
			cb: (err: Error | null, result: { stdout: string }) => void,
		) => {
			cb(null, { stdout: JSON.stringify({ chapters: [{}, {}] }) });
		},
	);
});

describe("POST /api/recording/chapters/[id] — success path (T010)", () => {
	it("returns 200 with ChapterRegenerationResult on valid request", async () => {
		// Mock ffprobe chapter count to match ffmetadata (2 chapters)
		mockExecFile.mockImplementation(
			(
				_cmd: string,
				_args: string[],
				cb: (err: Error | null, result: { stdout: string }) => void,
			) => {
				cb(null, { stdout: JSON.stringify({ chapters: [{}, {}] }) });
			},
		);

		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("assetId", VALID_ASSET_ID);
		expect(data).toHaveProperty("muxAssetId");
		expect(data).toHaveProperty("chapterCount", 2);
	});
});

describe("POST /api/recording/chapters/[id] — error paths (T011)", () => {
	it("returns 400 for invalid assetId format", async () => {
		const req = makeAuthedRequest("invalid-id");
		const res = await POST(req, { params: Promise.resolve({ id: "invalid-id" }) });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("returns 404 RECORDING_NOT_FOUND when raw MP4 missing", async () => {
		mockResolveFilePath.mockResolvedValue(null);
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("RECORDING_NOT_FOUND");
	});

	it("returns 404 FFMETADATA_NOT_FOUND when blob missing", async () => {
		mockReadFFMetadata.mockResolvedValue({ doc: null, corrupt: false });
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("FFMETADATA_NOT_FOUND");
	});

	it("returns 409 RECORDING_IN_PROGRESS when recording active", async () => {
		mockIsRecording.mockReturnValue(true);
		mockGetSessionState.mockReturnValue({ sessionId: VALID_ASSET_ID });
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe("RECORDING_IN_PROGRESS");
	});

	it("returns 422 FFMETADATA_INVALID when blob is corrupt", async () => {
		mockReadFFMetadata.mockResolvedValue({ doc: null, corrupt: true });
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.error.code).toBe("FFMETADATA_INVALID");
	});

	it("returns 502 REMUX_FAILED when FFmpeg remux fails", async () => {
		const { RemuxFailedError } = await import("@/lib/recording/ffmpeg-remux");
		mockReadFFMetadata.mockResolvedValue({ doc: VALID_FFMETADATA, corrupt: false });
		mockRemuxWithChapters.mockRejectedValue(
			new RemuxFailedError("FFmpeg failed", 1, "error output"),
		);
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error.code).toBe("REMUX_FAILED");
	});

	it("returns 503 BLOB_STORAGE_UNAVAILABLE when blob read fails", async () => {
		const { BlobStorageError } = await import("@/lib/recording/ffmetadata-blob");
		mockReadFFMetadata.mockRejectedValue(new BlobStorageError("timeout"));
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error.code).toBe("BLOB_STORAGE_UNAVAILABLE");
	});
});
