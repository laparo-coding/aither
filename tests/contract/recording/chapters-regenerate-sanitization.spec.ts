// ---------------------------------------------------------------------------
// Contract Tests: POST /api/recording/chapters/[id] — Sanitization (Spec 010)
// Task: T019 — Ensure error responses never leak bearer tokens, blob URLs,
//               internal filesystem paths, or secret values.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (same as chapters-regenerate.spec.ts) ───────────────────────────

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		RECORDINGS_OUTPUT_DIR: "output/recordings",
		MUX_TOKEN_ID: "super-secret-mux-id",
		MUX_TOKEN_SECRET: "super-secret-mux-secret",
	}),
}));

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
	ErrorSeverity: { ERROR: "error", WARNING: "warning", INFO: "info", CRITICAL: "critical" },
}));

vi.mock("@/lib/recording/session-manager", () => ({
	isRecording: vi.fn().mockReturnValue(false),
	getSessionState: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/recording/file-manager", () => ({
	resolveFilePath: vi.fn().mockResolvedValue("/output/recordings/rec_2026-07-13T10-30-00Z.mp4"),
	getDuration: vi.fn().mockResolvedValue(7200),
}));

vi.mock("@/lib/recording/ffmetadata-blob", () => ({
	readFFMetadata: vi.fn().mockResolvedValue({ doc: null, corrupt: false }),
	BlobStorageError: class BlobStorageError extends Error {
		constructor(message: string) {
			super(`BLOB_STORAGE_UNAVAILABLE: ${message}`);
			this.name = "BlobStorageError";
		}
	},
}));

vi.mock("@/lib/recording/ffmpeg-remux", () => ({
	remuxWithChapters: vi.fn(),
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

vi.mock("@/lib/recording/mux-uploader", () => ({
	uploadToMux: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	unlink: vi.fn().mockResolvedValue(undefined),
}));

// node:child_process execFile mock (for ffprobe chapter count validation)
vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_ASSET_ID = "rec_2026-07-13T10-30-00Z";
const SECRET_TOKEN = "super-secret-bearer-token-1234567890";
const SECRET_PATH = "/internal/output/recordings/secret.mp4";
const SECRET_BLOB_URL = "https://blob.vercel-storage.com/ffmetadata/secret.json?token=abc";

function makeAuthedRequest(id: string): NextRequest {
	const url = `http://localhost:3000/api/recording/chapters/${id}`;
	return new Request(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${SECRET_TOKEN}`,
		},
	}) as NextRequest;
}

function extractResponseBody(res: Response): unknown {
	return res.json();
}

function assertNoSecrets(body: unknown): void {
	const serialized = JSON.stringify(body);
	expect(serialized).not.toContain(SECRET_TOKEN);
	expect(serialized).not.toContain(SECRET_PATH);
	expect(serialized).not.toContain(SECRET_BLOB_URL);
	expect(serialized).not.toContain("super-secret-mux-id");
	expect(serialized).not.toContain("super-secret-mux-secret");
}

// ── Import route after mocks ───────────────────────────────────────────────

import { POST } from "@/app/api/recording/chapters/[id]/route";

beforeEach(() => {
	process.env.URANOS_SYNC_TOKEN = SECRET_TOKEN;
});

describe("POST /api/recording/chapters/[id] — sanitization (T019)", () => {
	it("400 error response does not leak bearer token or internal paths", async () => {
		const req = makeAuthedRequest("invalid-id");
		const res = await POST(req, { params: Promise.resolve({ id: "invalid-id" }) });
		expect(res.status).toBe(400);
		const body = await extractResponseBody(res);
		assertNoSecrets(body);
	});

	it("404 RECORDING_NOT_FOUND error response does not leak secrets", async () => {
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await extractResponseBody(res);
		assertNoSecrets(body);
	});

	it("404 FFMETADATA_NOT_FOUND error response does not leak blob URLs", async () => {
		const req = makeAuthedRequest(VALID_ASSET_ID);
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(404);
		const body = await extractResponseBody(res);
		assertNoSecrets(body);
	});

	it("401 error response does not echo the bearer token", async () => {
		// Invalid Authorization header (wrong token) → 401
		const url = `http://localhost:3000/api/recording/chapters/${VALID_ASSET_ID}`;
		const req = new Request(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer wrong-token",
			},
		}) as NextRequest;
		const res = await POST(req, { params: Promise.resolve({ id: VALID_ASSET_ID }) });
		expect(res.status).toBe(401);
		const body = await extractResponseBody(res);
		assertNoSecrets(body);
	});
});
