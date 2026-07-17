// ---------------------------------------------------------------------------
// Contract Tests: Uranos Timestamp API
// Task: T001 — POST /api/recording/timestamp shapes & status codes
// Covers: 200 (happy path), 400 INVALID_REQUEST, 400 INVALID_TIMESTAMP,
//         401 UNAUTHORIZED, 403 FORBIDDEN, 404 NO_ACTIVE_RECORDING,
//         429 TOO_MANY_REQUESTS, 503 BLOB_STORAGE_UNAVAILABLE
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ------------------------------------------------------------------

// Valid Uranos service token for tests
const VALID_URANOS_TOKEN = "test-uranos-sync-token-0123456789abcdef0123456789abcdef";

// Set env vars for the auth guard (reads process.env directly)
process.env.URANOS_SYNC_TOKEN = VALID_URANOS_TOKEN;
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		WEBCAM_STREAM_URL: "rtsp://192.168.1.100:554/stream",
		RECORDINGS_OUTPUT_DIR: "output/recordings",
		BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
		URANOS_SYNC_TOKEN: VALID_URANOS_TOKEN,
	}),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
	ErrorSeverity: { ERROR: "error", WARNING: "warning", INFO: "info" },
}));

// Session manager mock — default: active recording
const ACTIVE_SESSION = {
	sessionId: "rec_2026-07-13T10-30-00Z",
	filename: "rec_2026-07-13T10-30-00Z.mp4",
	status: "recording",
	startedAt: "2026-07-13T10:30:00.000Z",
	endedAt: null,
	duration: null,
	fileSize: null,
	filePath: "output/recordings/rec_2026-07-13T10-30-00Z.mp4",
	maxDurationReached: false,
	error: null,
};

const mockGetSessionState = vi.fn().mockReturnValue(ACTIVE_SESSION);
const mockIsRecording = vi.fn().mockReturnValue(true);

vi.mock("@/lib/recording/session-manager", () => ({
	getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
	isRecording: (...args: unknown[]) => mockIsRecording(...args),
}));

// Blob mock — default: no existing blob, write succeeds
const mockReadFFMetadata = vi.fn().mockResolvedValue({ doc: null, corrupt: false });
const mockWriteFFMetadata = vi.fn().mockResolvedValue({
	url: "https://xxxx.public.blob.vercel-storage.com/ffmetadata/rec_2026-07-13T10-30-00Z.json",
});

// BlobStorageError class for mock (must match the route's instanceof check)
class MockBlobStorageError extends Error {
	constructor(message: string) {
		super(`BLOB_STORAGE_UNAVAILABLE: ${message}`);
		this.name = "BlobStorageError";
	}
}

vi.mock("@/lib/recording/ffmetadata-blob", () => ({
	readFFMetadata: (...args: unknown[]) => mockReadFFMetadata(...args),
	writeFFMetadata: (...args: unknown[]) => mockWriteFFMetadata(...args),
	getBlobPath: (assetId: string) => `ffmetadata/${assetId}.json`,
	BlobStorageError: MockBlobStorageError,
}));

// Lock mock — pass-through
vi.mock("@/lib/recording/ffmetadata-lock", () => ({
	withAssetLock: vi.fn(async (_assetId: string, fn: () => Promise<unknown>) => fn()),
}));

// Route auth mock — default: no session (token-only auth)
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue(null),
}));

// --- Helpers ----------------------------------------------------------------

function createTimestampRequest(
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): NextRequest {
	return new NextRequest(new URL("http://localhost:3001/api/recording/timestamp"), {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
		// biome-ignore lint/suspicious/noExplicitAny: test helper requires flexible typing
	} as any);
}

function authHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

// Recording start: 2026-07-13T10:30:00.000Z → unix 1720866600 (approx)
// We use a fixed startedAt and compute timestamps relative to it.
const RECORDING_START_UNIX = Math.floor(new Date("2026-07-13T10:30:00.000Z").getTime() / 1000);

// --- Tests ------------------------------------------------------------------

describe("POST /api/recording/timestamp", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetSessionState.mockReturnValue(ACTIVE_SESSION);
		mockIsRecording.mockReturnValue(true);
		mockReadFFMetadata.mockResolvedValue({ doc: null, corrupt: false });
		mockWriteFFMetadata.mockResolvedValue({
			url: "https://xxxx.public.blob.vercel-storage.com/ffmetadata/rec_2026-07-13T10-30-00Z.json",
		});
	});

	describe("200 — Happy path", () => {
		it("creates a new ffmetadata blob on first timestamp", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.success).toBe(true);
			expect(json.data).toHaveProperty("assetId", "rec_2026-07-13T10-30-00Z");
			expect(json.data).toHaveProperty("chapterId", 0);
			expect(json.data).toHaveProperty("blobKey", "ffmetadata/rec_2026-07-13T10-30-00Z.json");
			expect(mockWriteFFMetadata).toHaveBeenCalledTimes(1);
		});

		it("appends a chapter on subsequent timestamp", async () => {
			const existingDoc = {
				metadata: { title: "rec_2026-07-13T10-30-00Z", encoder: "aither-ffmetadata" },
				chapters: [{ id: 0, start: 5000000, end: 5000000, title: "Chapter 1" }],
			};
			mockReadFFMetadata.mockResolvedValue({ doc: existingDoc, corrupt: false });

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 20 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.success).toBe(true);
			expect(json.data.chapterId).toBe(1);
			expect(mockWriteFFMetadata).toHaveBeenCalledTimes(1);
		});
	});

	describe("400 — Invalid request", () => {
		it("returns 400 INVALID_REQUEST for missing timestamp", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest({}, authHeader(VALID_URANOS_TOKEN));
			const res = await POST(req);

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.success).toBe(false);
			expect(json.error.code).toBe("INVALID_REQUEST");
			expect(mockWriteFFMetadata).not.toHaveBeenCalled();
		});

		it("returns 400 INVALID_REQUEST for non-integer timestamp", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest({ timestamp: 123.45 }, authHeader(VALID_URANOS_TOKEN));
			const res = await POST(req);

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error.code).toBe("INVALID_REQUEST");
		});

		it("returns 400 INVALID_REQUEST for non-positive timestamp", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest({ timestamp: -1 }, authHeader(VALID_URANOS_TOKEN));
			const res = await POST(req);

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error.code).toBe("INVALID_REQUEST");
		});
	});

	describe("400 — Invalid timestamp", () => {
		it("returns 400 INVALID_TIMESTAMP for timestamp before recording start", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX - 1 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error.code).toBe("INVALID_TIMESTAMP");
			expect(mockWriteFFMetadata).not.toHaveBeenCalled();
		});

		it("returns 400 INVALID_TIMESTAMP for non-monotonic timestamp (<= last chapter start)", async () => {
			const existingDoc = {
				metadata: { title: "rec_2026-07-13T10-30-00Z", encoder: "aither-ffmetadata" },
				chapters: [
					{ id: 0, start: 5000000, end: 20000000, title: "Chapter 1" },
					{ id: 1, start: 20000000, end: 20000000, title: "Chapter 2" },
				],
			};
			mockReadFFMetadata.mockResolvedValue({ doc: existingDoc, corrupt: false });

			const { POST } = await import("@/app/api/recording/timestamp/route");
			// offset 15s <= last chapter start (20s)
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 15 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error.code).toBe("INVALID_TIMESTAMP");
			expect(mockWriteFFMetadata).not.toHaveBeenCalled();
		});
	});

	describe("401 — Unauthorized", () => {
		it("returns 401 when no Authorization header is present", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest({ timestamp: RECORDING_START_UNIX + 5 });
			const res = await POST(req);

			expect(res.status).toBe(401);
			const json = await res.json();
			expect(json.error.code).toBe("UNAUTHORIZED");
			expect(mockWriteFFMetadata).not.toHaveBeenCalled();
		});

		it("returns 401 for invalid bearer token", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader("wrong-token"),
			);
			const res = await POST(req);

			expect(res.status).toBe(401);
			const json = await res.json();
			expect(json.error.code).toBe("UNAUTHORIZED");
		});

		it("returns 401 when URANOS_SYNC_TOKEN is unset and no admin session (FR-018a)", async () => {
			const originalToken = process.env.URANOS_SYNC_TOKEN;
			// biome-ignore lint/performance/noDelete: intentionally removes key to test truly-unset path
			delete process.env.URANOS_SYNC_TOKEN;

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader("some-token"),
			);
			const res = await POST(req);

			process.env.URANOS_SYNC_TOKEN = originalToken;

			expect(res.status).toBe(401);
			const json = await res.json();
			expect(json.error.code).toBe("UNAUTHORIZED");
			expect(mockWriteFFMetadata).not.toHaveBeenCalled();
		});

		it("returns 200 for admin session when URANOS_SYNC_TOKEN is unset (FR-018a fallback)", async () => {
			const originalToken = process.env.URANOS_SYNC_TOKEN;
			// biome-ignore lint/performance/noDelete: intentionally removes key to test truly-unset path
			delete process.env.URANOS_SYNC_TOKEN;

			const { getRouteAuth } = await import("@/lib/auth/route-auth");
			vi.mocked(getRouteAuth).mockResolvedValueOnce({
				userId: "admin_123",
				sessionClaims: { metadata: { role: "admin" } },
			});

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest({ timestamp: RECORDING_START_UNIX + 5 });
			const res = await POST(req);

			process.env.URANOS_SYNC_TOKEN = originalToken;

			expect(res.status).toBe(200);
			expect(mockWriteFFMetadata).toHaveBeenCalledTimes(1);
		});
	});

	describe("403 — Forbidden", () => {
		it("returns 403 for authenticated non-admin session without valid token", async () => {
			const { getRouteAuth } = await import("@/lib/auth/route-auth");
			vi.mocked(getRouteAuth).mockResolvedValueOnce({
				userId: "user_123",
				sessionClaims: { metadata: { role: "participant" } },
			});

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest({ timestamp: RECORDING_START_UNIX + 5 });
			const res = await POST(req);

			expect(res.status).toBe(403);
			const json = await res.json();
			expect(json.error.code).toBe("FORBIDDEN");
		});
	});

	describe("404 — No active recording", () => {
		it("returns 404 NO_ACTIVE_RECORDING when no session is active", async () => {
			mockGetSessionState.mockReturnValue(null);
			mockIsRecording.mockReturnValue(false);

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(404);
			const json = await res.json();
			expect(json.error.code).toBe("NO_ACTIVE_RECORDING");
			expect(mockWriteFFMetadata).not.toHaveBeenCalled();
		});

		it("returns 404 when recording status is completed", async () => {
			mockGetSessionState.mockReturnValue({ ...ACTIVE_SESSION, status: "completed" });
			mockIsRecording.mockReturnValue(false);

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(404);
			const json = await res.json();
			expect(json.error.code).toBe("NO_ACTIVE_RECORDING");
		});
	});

	describe("503 — Blob storage unavailable", () => {
		it("returns 503 BLOB_STORAGE_UNAVAILABLE when blob write fails", async () => {
			mockWriteFFMetadata.mockRejectedValueOnce(new MockBlobStorageError("write failed"));

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(503);
			const json = await res.json();
			expect(json.error.code).toBe("BLOB_STORAGE_UNAVAILABLE");
		});
	});

	describe("429 — Too many requests", () => {
		it("returns 429 TOO_MANY_REQUESTS with Retry-After when rate limit is exceeded", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");

			for (let i = 0; i < 60; i++) {
				const req = createTimestampRequest(
					{ timestamp: RECORDING_START_UNIX + 5 + i },
					authHeader(VALID_URANOS_TOKEN),
				);
				const res = await POST(req);
				expect([200, 400]).toContain(res.status);
			}

			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 1000 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(429);
			expect(res.headers.get("Retry-After")).toBeTruthy();
			const json = await res.json();
			expect(json.error.code).toBe("TOO_MANY_REQUESTS");
		});
	});

	describe("Idempotent retry (FR-022)", () => {
		it("returns 200 with existing chapterId for equal-to-last timestamp (retry)", async () => {
			const existingDoc = {
				metadata: { title: "rec_2026-07-13T10-30-00Z", encoder: "aither-ffmetadata" },
				chapters: [
					{ id: 0, start: 5000000, end: 20000000, title: "Chapter 1" },
					{ id: 1, start: 20000000, end: 20000000, title: "Chapter 2" },
				],
			};
			mockReadFFMetadata.mockResolvedValue({ doc: existingDoc, corrupt: false });

			const { POST } = await import("@/app/api/recording/timestamp/route");
			// offset 20s == last chapter start (20s) → idempotent retry
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 20 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.success).toBe(true);
			expect(json.data.chapterId).toBe(1); // existing chapter, no new one
		});
	});

	describe("Corrupt blob (FR-023)", () => {
		it("discards corrupt blob and starts fresh", async () => {
			mockReadFFMetadata.mockResolvedValue({ doc: null, corrupt: true });

			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.success).toBe(true);
			expect(json.data.chapterId).toBe(0); // fresh start
			expect(mockWriteFFMetadata).toHaveBeenCalledTimes(1);
		});
	});

	describe("No secret leakage (SC-006)", () => {
		it("does not leak bearer token, URANOS_SYNC_TOKEN, or BLOB_READ_WRITE_TOKEN in response", async () => {
			const { POST } = await import("@/app/api/recording/timestamp/route");
			const req = createTimestampRequest(
				{ timestamp: RECORDING_START_UNIX + 5 },
				authHeader(VALID_URANOS_TOKEN),
			);
			const res = await POST(req);

			const text = await res.text();
			expect(text).not.toContain(VALID_URANOS_TOKEN);
			expect(text).not.toContain("vercel_blob_rw_test_token");
			expect(text).not.toContain("output/recordings");
		});
	});
});
