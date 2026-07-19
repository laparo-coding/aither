// ---------------------------------------------------------------------------
// Contract Tests: Sanitization for Chapters & Playback (Spec 010)
// Task: T036 — No token/path/blob URL leakage in
//               GET /api/recording/chapters/[id] and
//               POST /api/recording/playback/play error responses.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		BLOB_READ_WRITE_TOKEN: "super-secret-blob-token",
		RECORDINGS_OUTPUT_DIR: "/internal/output/recordings",
		MUX_TOKEN_ID: "super-secret-mux-id",
		MUX_TOKEN_SECRET: "super-secret-mux-secret",
	}),
}));

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({ status: 200, body: {} }),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
	ErrorSeverity: { ERROR: "error", WARNING: "warning" },
}));

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: vi.fn().mockResolvedValue(null),
	storeChapteredAssetMapping: vi.fn(),
}));

vi.mock("@/lib/recording/chapter-extractor", () => ({
	extractChapters: vi.fn(),
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
const SECRET_BLOB_TOKEN = "super-secret-blob-token";
const SECRET_MUX_ID = "super-secret-mux-id";
const SECRET_MUX_SECRET = "super-secret-mux-secret";
const INTERNAL_PATH = "/internal/output/recordings";

function assertNoSecrets(body: unknown): void {
	const serialized = JSON.stringify(body);
	expect(serialized).not.toContain(SECRET_BLOB_TOKEN);
	expect(serialized).not.toContain(SECRET_MUX_ID);
	expect(serialized).not.toContain(SECRET_MUX_SECRET);
	expect(serialized).not.toContain(INTERNAL_PATH);
}

function makeChaptersGetRequest(): NextRequest {
	const url = `http://localhost:3000/api/recording/chapters/${VALID_ASSET_ID}`;
	return new Request(url, {
		method: "GET",
		headers: { Authorization: "Bearer test-token" },
	}) as NextRequest;
}

function makePlayRequest(): NextRequest {
	const url = "http://localhost:3000/api/recording/playback/play";
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ recordingId: VALID_ASSET_ID, chapterId: 0 }),
	}) as NextRequest;
}

// ── Import routes after mocks ─────────────────────────────────────────────

import { GET } from "@/app/api/recording/chapters/[id]/route";
import { POST as PLAY_POST } from "@/app/api/recording/playback/play/route";

beforeEach(() => {
	process.env.URANOS_SYNC_TOKEN = "test-token";
});

describe("Sanitization — GET /api/recording/chapters/[id] (T036)", () => {
	it("404 CHAPTERS_NOT_GENERATED response does not leak secrets", async () => {
		const req = makeChaptersGetRequest();
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		assertNoSecrets(body);
	});

	it("400 error response does not leak internal paths", async () => {
		const req = makeChaptersGetRequest();
		const res = await GET(req, { params: Promise.resolve({ id: "invalid-id" }) });
		expect(res.status).toBe(400);
		const body = await res.json();
		assertNoSecrets(body);
	});
});

describe("Sanitization — POST /api/recording/playback/play (T036)", () => {
	it("404 CHAPTERS_NOT_GENERATED response does not leak secrets", async () => {
		const req = makePlayRequest();
		const res = await PLAY_POST(req);
		expect(res.status).toBe(404);
		const body = await res.json();
		assertNoSecrets(body);
	});

	it("400 error response does not leak internal paths", async () => {
		const url = "http://localhost:3000/api/recording/playback/play";
		const req = new Request(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		}) as NextRequest;
		const res = await PLAY_POST(req);
		expect(res.status).toBe(400);
		const body = await res.json();
		assertNoSecrets(body);
	});
});
