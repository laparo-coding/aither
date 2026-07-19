// ---------------------------------------------------------------------------
// Contract Tests: Stream Sanitization (Spec 010)
// Task: T037 — No token/path/blob URL leakage in 416 and 500 error responses
//               for GET /api/recording/stream/[id]
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
	loadConfig: vi.fn().mockReturnValue({
		BLOB_READ_WRITE_TOKEN: "super-secret-blob-token",
		RECORDINGS_OUTPUT_DIR: "/internal/output/recordings",
		MUX_TOKEN_ID: "super-secret-mux-id",
		MUX_TOKEN_SECRET: "super-secret-mux-secret",
	}),
}));

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/recording/file-manager", () => ({
	resolveFilePath: vi.fn().mockResolvedValue("output/recordings/raw.mp4"),
}));

vi.mock("@/lib/recording/stream-handler", () => ({
	createStreamResponse: vi.fn(),
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

function makeStreamRequest(id: string, range?: string): NextRequest {
	const url = `http://localhost:3000/api/recording/stream/${id}`;
	const headers: Record<string, string> = {};
	if (range) headers.Range = range;
	return new Request(url, { method: "GET", headers }) as NextRequest;
}

// ── Import route after mocks ───────────────────────────────────────────────

import { GET } from "@/app/api/recording/stream/[id]/route";
import { createStreamResponse } from "@/lib/recording/stream-handler";

beforeEach(() => {
	// Default: no chaptered asset, raw file exists
});

describe("Sanitization — GET /api/recording/stream/[id] (T037)", () => {
	it("416 error response does not leak secrets", async () => {
		vi.mocked(createStreamResponse).mockResolvedValue({
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
		// 416 response body (if any) should not leak secrets
		const text = await res.text();
		expect(text).not.toContain(SECRET_BLOB_TOKEN);
		expect(text).not.toContain(SECRET_MUX_ID);
		expect(text).not.toContain(SECRET_MUX_SECRET);
		expect(text).not.toContain(INTERNAL_PATH);
	});

	it("500 error response does not leak secrets", async () => {
		vi.mocked(createStreamResponse).mockRejectedValue(new Error("Internal failure"));
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(500);
		const body = await res.json();
		assertNoSecrets(body);
	});

	it("404 error response does not leak internal paths", async () => {
		// Override file-manager mock for this test
		const { resolveFilePath } = await import("@/lib/recording/file-manager");
		vi.mocked(resolveFilePath).mockResolvedValue(null);
		const req = makeStreamRequest(VALID_ASSET_ID);
		const res = await GET(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await res.json();
		assertNoSecrets(body);
	});

	it("400 error response does not leak secrets", async () => {
		const req = makeStreamRequest("invalid-id");
		const res = await GET(req, { params: Promise.resolve({ id: "invalid-id" }) });
		expect(res.status).toBe(400);
		const body = await res.json();
		assertNoSecrets(body);
	});
});
