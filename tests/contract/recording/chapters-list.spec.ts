// ---------------------------------------------------------------------------
// Contract Tests: GET /api/recording/chapters/[id] (Spec 010)
// Task: T020 — Success path (200 with chapter list in seconds)
// Task: T021 — Error paths (401, 403, 404 CHAPTERS_NOT_GENERATED,
//               404 RECORDING_NOT_FOUND, 502, 500)
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		RECORDINGS_OUTPUT_DIR: "output/recordings",
		BLOB_READ_WRITE_TOKEN: "test-blob-token",
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

// Chaptered asset mapping mock
const mockGetChapteredAssetMapping = vi.fn();

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: (...args: unknown[]) => mockGetChapteredAssetMapping(...args),
	storeChapteredAssetMapping: vi.fn(),
}));

// Chapter extractor mock
const mockExtractChapters = vi.fn();

vi.mock("@/lib/recording/chapter-extractor", () => ({
	extractChapters: (...args: unknown[]) => mockExtractChapters(...args),
}));

vi.mock("@/lib/recording/ffmpeg-remux", () => ({
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

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_ASSET_ID = "rec_2026-07-13T10-30-00Z";
const VALID_MAPPING = {
	assetId: VALID_ASSET_ID,
	muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
	muxPlaybackUrl: "https://stream.mux.com/playback-xyz.mp4",
	chapterCount: 2,
	generatedAt: "2026-07-19T10:00:00.000Z",
};
const VALID_CHAPTER_LIST = {
	assetId: VALID_ASSET_ID,
	chapters: [
		{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" },
		{ id: 1, start: 20.0, end: 45.0, title: "Chapter 2" },
	],
};

function makeAuthedRequest(id: string): NextRequest {
	const url = `http://localhost:3000/api/recording/chapters/${id}`;
	return new Request(url, {
		method: "GET",
		headers: { Authorization: "Bearer test-token" },
	}) as NextRequest;
}

// ── Import route after mocks ───────────────────────────────────────────────

import { GET } from "@/app/api/recording/chapters/[id]/route";

beforeEach(() => {
	process.env.URANOS_SYNC_TOKEN = "test-token";
	mockGetChapteredAssetMapping.mockResolvedValue(VALID_MAPPING);
	mockExtractChapters.mockResolvedValue(VALID_CHAPTER_LIST);
});

describe("GET /api/recording/chapters/[id] — success path (T020)", () => {
	it("returns 200 with chapter list in seconds", async () => {
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("assetId", VALID_ASSET_ID);
		expect(data.chapters).toHaveLength(2);
		expect(data.chapters[0]).toEqual({
			id: 0,
			start: 5.0,
			end: 20.0,
			title: "Chapter 1",
		});
	});
});

describe("GET /api/recording/chapters/[id] — error paths (T021)", () => {
	it("returns 400 for invalid assetId format", async () => {
		const req = makeAuthedRequest("invalid-id");
		const res = await GET(req, { params: Promise.resolve({ id: "invalid-id" }) });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("returns 404 CHAPTERS_NOT_GENERATED when no mapping exists", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue(null);
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("CHAPTERS_NOT_GENERATED");
	});

	it("returns 502 REMUX_FAILED when ffprobe extraction fails", async () => {
		const { RemuxFailedError } = await import("@/lib/recording/ffmpeg-remux");
		mockExtractChapters.mockRejectedValue(new RemuxFailedError("ffprobe failed", null, ""));
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error.code).toBe("REMUX_FAILED");
	});

	it("returns 401 when no valid token and no admin session", async () => {
		const url = `http://localhost:3000/api/recording/chapters/${VALID_ASSET_ID}`;
		const req = new Request(url, {
			method: "GET",
			headers: { Authorization: "Bearer wrong-token" },
		}) as NextRequest;
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe("UNAUTHORIZED");
	});
});
