// ---------------------------------------------------------------------------
// Contract Tests: GET /api/recording/stream/[id] (Spec 010)
// Task: T030 — Serve chaptered MP4 (200 with Content-Type, Content-Length, Accept-Ranges)
// Task: T031 — Range header (206 Partial Content, Content-Range)
// Task: T032 — Fallback to raw MP4 when chaptered variant absent
// Task: T034 — Invalid Range header returns 416 Range Not Satisfiable
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({ status: 200, body: {} }),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({ BLOB_READ_WRITE_TOKEN: "test-token" }),
}));

// Chaptered asset mapping mock
const mockGetChapteredAssetMapping = vi.fn();

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: (...args: unknown[]) => mockGetChapteredAssetMapping(...args),
}));

// File manager mock
const mockResolveFilePath = vi.fn();

vi.mock("@/lib/recording/file-manager", () => ({
	resolveFilePath: (...args: unknown[]) => mockResolveFilePath(...args),
}));

// Stream handler mock
const mockCreateStreamResponse = vi.fn();

vi.mock("@/lib/recording/stream-handler", () => ({
	createStreamResponse: (...args: unknown[]) => mockCreateStreamResponse(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_ASSET_ID = "rec_2026-07-13T10-30-00Z";
const MUX_PLAYBACK_URL = "https://stream.mux.com/playback-xyz.mp4";
const RAW_FILE_PATH = "output/recordings/rec_2026-07-13T10-30-00Z.mp4";

function makeStreamRequest(id: string, range?: string): NextRequest {
	const url = `http://localhost:3000/api/recording/stream/${id}`;
	const headers: Record<string, string> = {};
	if (range) headers.Range = range;
	return new Request(url, { method: "GET", headers }) as NextRequest;
}

// ── Import route after mocks ───────────────────────────────────────────────

import { GET } from "@/app/api/recording/stream/[id]/route";

beforeEach(() => {
	mockGetChapteredAssetMapping.mockResolvedValue(null);
	mockResolveFilePath.mockResolvedValue(RAW_FILE_PATH);
	mockCreateStreamResponse.mockResolvedValue({
		stream: new ReadableStream({
			start(controller) {
				controller.close();
			},
		}),
		headers: {
			"Content-Type": "video/mp4",
			"Content-Length": "1500000000",
			"Accept-Ranges": "bytes",
		},
		status: 200,
	});
});

describe("GET /api/recording/stream/[id] — chaptered asset (T030)", () => {
	it("redirects to MUX CDN URL when chaptered asset exists", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue({
			assetId: VALID_ASSET_ID,
			muxAssetId: "mux_test",
			muxPlaybackUrl: MUX_PLAYBACK_URL,
			chapterCount: 5,
			generatedAt: "2026-07-19T10:00:00.000Z",
		});
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(MUX_PLAYBACK_URL);
	});

	it("rejects non-allowlisted redirect targets from mapping", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue({
			assetId: VALID_ASSET_ID,
			muxAssetId: "mux_test",
			muxPlaybackUrl: "http://evil.example/phish",
			chapterCount: 5,
			generatedAt: "2026-07-19T10:00:00.000Z",
		});
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("INTERNAL_ERROR");
	});

	it("rejects mux.com hosts outside approved playback subdomains", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue({
			assetId: VALID_ASSET_ID,
			muxAssetId: "mux_test",
			muxPlaybackUrl: "https://video.mux.com/playback-xyz.mp4",
			chapterCount: 5,
			generatedAt: "2026-07-19T10:00:00.000Z",
		});
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("INTERNAL_ERROR");
	});

	it("rejects redirect URLs containing credentials", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue({
			assetId: VALID_ASSET_ID,
			muxAssetId: "mux_test",
			muxPlaybackUrl: "https://user:pass@stream.mux.com/playback-xyz.mp4",
			chapterCount: 5,
			generatedAt: "2026-07-19T10:00:00.000Z",
		});
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("INTERNAL_ERROR");
	});
});

describe("GET /api/recording/stream/[id] — raw fallback (T032)", () => {
	it("serves raw MP4 when no chaptered asset exists", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue(null);
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("video/mp4");
		expect(res.headers.get("Accept-Ranges")).toBe("bytes");
	});

	it("returns 404 when neither chaptered nor raw asset exists", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue(null);
		mockResolveFilePath.mockResolvedValue(null);
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("NOT_FOUND");
	});
});

describe("GET /api/recording/stream/[id] — Range support (T031, T034)", () => {
	it("returns 206 Partial Content for Range request", async () => {
		mockCreateStreamResponse.mockResolvedValue({
			stream: new ReadableStream({
				start(c) {
					c.close();
				},
			}),
			headers: {
				"Content-Type": "video/mp4",
				"Content-Range": "bytes 0-1023/2048",
				"Content-Length": "1024",
			},
			status: 206,
		});
		const req = makeStreamRequest(VALID_ASSET_ID, "bytes=0-1023");
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toBe("bytes 0-1023/2048");
	});

	it("returns 416 Range Not Satisfiable for invalid Range", async () => {
		mockCreateStreamResponse.mockResolvedValue({
			stream: new ReadableStream({
				start(c) {
					c.close();
				},
			}),
			headers: { "Content-Type": "application/json" },
			status: 416,
		});
		const req = makeStreamRequest(VALID_ASSET_ID, "bytes=99999999-");
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(416);
	});
});

describe("GET /api/recording/stream/[id] — validation", () => {
	it("returns 400 for invalid assetId format", async () => {
		const req = makeStreamRequest("invalid-id");
		const res = await GET(req, { params: Promise.resolve({ id: "invalid-id" }) });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});
});
