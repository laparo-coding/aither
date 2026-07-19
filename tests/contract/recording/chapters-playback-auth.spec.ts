// ---------------------------------------------------------------------------
// Contract Tests: Auth Matrix for Chapters & Playback (Spec 010)
// Task: T035 — Explicit 401 vs 403 scenarios for
//               GET /api/recording/chapters/[id] and
//               POST /api/recording/playback/play
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		BLOB_READ_WRITE_TOKEN: "test-token",
		RECORDINGS_OUTPUT_DIR: "output/recordings",
	}),
}));

// Auth mocks — configurable per test
const mockGetRouteAuth = vi.fn();

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: () => mockGetRouteAuth(),
}));

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn((auth: unknown) => {
		const role = (auth as { sessionClaims?: { metadata?: { role?: string } } })?.sessionClaims
			?.metadata?.role;
		if (role === "admin") return { status: 200, body: {} };
		if (role === undefined) return { status: 401, body: { error: "UNAUTHORIZED" } };
		return { status: 403, body: { error: "FORBIDDEN" } };
	}),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
	ErrorSeverity: { ERROR: "error", WARNING: "warning" },
}));

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: vi.fn().mockResolvedValue({
		assetId: "rec_2026-07-13T10-30-00Z",
		muxAssetId: "mux_test",
		muxPlaybackUrl: "https://stream.mux.com/test.mp4",
		chapterCount: 1,
		generatedAt: "2026-07-19T10:00:00.000Z",
	}),
	storeChapteredAssetMapping: vi.fn(),
}));

vi.mock("@/lib/recording/chapter-extractor", () => ({
	extractChapters: vi.fn().mockResolvedValue({
		assetId: "rec_2026-07-13T10-30-00Z",
		chapters: [{ id: 0, start: 0, end: 10, title: "Chapter 1" }],
	}),
}));

vi.mock("@/lib/recording/ffmpeg-remux", () => ({
	RemuxFailedError: class RemuxFailedError extends Error {
		exitCode: number | null = null;
		stderr = "";
	},
}));

vi.mock("@/lib/recording/playback-controller", () => ({
	dispatchCommand: vi.fn().mockReturnValue(true),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_ASSET_ID = "rec_2026-07-13T10-30-00Z";

function makeChaptersGetRequest(authHeader?: string): NextRequest {
	const url = `http://localhost:3000/api/recording/chapters/${VALID_ASSET_ID}`;
	const headers: Record<string, string> = {};
	if (authHeader) headers.Authorization = authHeader;
	return new Request(url, { method: "GET", headers }) as NextRequest;
}

function makePlayRequest(authHeader?: string): NextRequest {
	const url = "http://localhost:3000/api/recording/playback/play";
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (authHeader) headers.Authorization = authHeader;
	return new Request(url, {
		method: "POST",
		headers,
		body: JSON.stringify({ recordingId: VALID_ASSET_ID, chapterId: 0 }),
	}) as NextRequest;
}

// ── Import routes after mocks ─────────────────────────────────────────────

import { GET } from "@/app/api/recording/chapters/[id]/route";
import { POST as PLAY_POST } from "@/app/api/recording/playback/play/route";

beforeEach(() => {
	process.env.URANOS_SYNC_TOKEN = "valid-sync-token";
	mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: undefined } } });
});

describe("Auth matrix — GET /api/recording/chapters/[id] (T035)", () => {
	it("returns 401 when no token and no session", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: undefined } } });
		const req = makeChaptersGetRequest();
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(401);
	});

	it("returns 401 when token is invalid and no session", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: undefined } } });
		const req = makeChaptersGetRequest("Bearer wrong-token");
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(401);
	});

	it("returns 200 when valid service token is provided", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: undefined } } });
		const req = makeChaptersGetRequest("Bearer valid-sync-token");
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(200);
	});

	it("returns 200 when admin session is provided (no token)", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } });
		const req = makeChaptersGetRequest();
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(200);
	});

	it("returns 403 when non-admin session without token", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: "user" } } });
		const req = makeChaptersGetRequest();
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(403);
	});
});

describe("Auth matrix — POST /api/recording/playback/play (T035)", () => {
	it("returns 401 when no admin session and no token", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: undefined } } });
		const req = makePlayRequest();
		const res = await PLAY_POST(req);
		expect(res.status).toBe(401);
	});

	it("returns 200 when admin session is provided", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } });
		const req = makePlayRequest();
		const res = await PLAY_POST(req);
		expect(res.status).toBe(200);
	});

	it("returns 403 when non-admin session", async () => {
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: "user" } } });
		const req = makePlayRequest();
		const res = await PLAY_POST(req);
		expect(res.status).toBe(403);
	});
});
