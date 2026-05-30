// ---------------------------------------------------------------------------
// Contract Tests: Auth Protection
// Task: T046 [US4] — Endpunkte geschützt: 401/403/200
// ---------------------------------------------------------------------------

import { POST as recPOST } from "@/app/api/recordings/route";
import { POST as syncPOST } from "@/app/api/sync/route";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock loadConfig
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn(() => ({
		HEMERA_API_BASE_URL: "https://api.hemera.test",
		HEMERA_API_KEY: "test-key-minimum-32-characters-long-for-validation",
		HTML_OUTPUT_DIR: "output",
	})),
}));

// Mock factory — prevent getTokenManager() from requiring HEMERA_API_KEY env var
vi.mock("@/lib/hemera/factory", () => ({
	createHemeraClient: vi.fn(() => ({
		get: vi.fn().mockResolvedValue([]),
		put: vi.fn().mockResolvedValue({}),
	})),
}));

// Mock getRouteAuth — controls what requireAdmin receives
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn(),
}));

// Mock orchestrator to prevent real sync execution on 202
vi.mock("@/lib/sync/orchestrator", () => ({
	SyncOrchestrator: vi.fn().mockImplementation(() => ({
		runDataSync: vi.fn().mockResolvedValue({
			jobId: "test",
			status: "success",
			startTime: new Date().toISOString(),
			endTime: new Date().toISOString(),
			durationMs: 0,
			courseId: null,
			noUpcomingCourse: true,
			participantsFetched: 0,
			filesGenerated: 0,
			filesSkipped: 0,
			errors: [],
		}),
	})),
}));

// Mock transmitRecording to prevent real Hemera API calls
vi.mock("@/lib/sync/recording-transmitter", () => ({
	transmitRecording: vi.fn().mockResolvedValue({
		success: true,
		seminarSourceId: "test-seminar",
		hemeraResponse: { status: 200, message: "OK" },
	}),
}));

const mockGetRouteAuth = vi.mocked(getRouteAuth);
const originalAitherSyncToken = process.env.AITHER_SYNC_TOKEN;

function createRequest(): NextRequest {
	return new NextRequest(new URL("http://localhost:3500/api/sync"), { method: "POST" });
}

describe("/api/sync and /api/recordings auth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.AITHER_SYNC_TOKEN = "gaia-local-aither-sync-token-20260530";
	});

	afterEach(() => {
		if (typeof originalAitherSyncToken === "string") {
			process.env.AITHER_SYNC_TOKEN = originalAitherSyncToken;
			return;
		}

		process.env.AITHER_SYNC_TOKEN = undefined;
	});

	it("POST /api/sync returns 401 for unauthenticated", async () => {
		mockGetRouteAuth.mockResolvedValue(null);
		const res = await syncPOST(createRequest());
		expect(res.status).toBe(401);
	});

	it("POST /api/recordings returns 403 for non-admin", async () => {
		mockGetRouteAuth.mockResolvedValue({
			sessionClaims: { metadata: { role: "participant" } },
		});
		const req = new NextRequest(new URL("http://localhost:3500/api/recordings"), {
			method: "POST",
			body: JSON.stringify({}),
			headers: { "Content-Type": "application/json" },
		});
		const res = await recPOST(req);
		expect(res.status).toBe(403);
	});

	it("POST /api/sync returns 202 for admin", async () => {
		mockGetRouteAuth.mockResolvedValue({
			sessionClaims: { metadata: { role: "admin" } },
		});
		const res = await syncPOST(createRequest());
		expect(res.status).toBe(202);
	});

	it("POST /api/sync returns 202 for a valid service bearer token", async () => {
		mockGetRouteAuth.mockResolvedValue(null);
		const req = new NextRequest(new URL("http://localhost:3500/api/sync"), {
			method: "POST",
			headers: {
				Authorization: "Bearer gaia-local-aither-sync-token-20260530",
			},
		});
		const res = await syncPOST(req);
		expect(res.status).toBe(202);
	});

	it("POST /api/sync returns 401 for an invalid service bearer token", async () => {
		mockGetRouteAuth.mockResolvedValue(null);
		const req = new NextRequest(new URL("http://localhost:3500/api/sync"), {
			method: "POST",
			headers: {
				Authorization: "Bearer invalid-token",
			},
		});
		const res = await syncPOST(req);
		expect(res.status).toBe(401);
	});

	it("POST /api/sync returns 403 for non-admin", async () => {
		mockGetRouteAuth.mockResolvedValue({
			sessionClaims: { metadata: { role: "participant" } },
		});
		const res = await syncPOST(createRequest());
		expect(res.status).toBe(403);
	});

	it("POST /api/recordings returns 401 for unauthenticated", async () => {
		mockGetRouteAuth.mockResolvedValue(null);
		const req = new NextRequest(new URL("http://localhost:3500/api/recordings"), {
			method: "POST",
			body: JSON.stringify({}),
			headers: { "Content-Type": "application/json" },
		});
		const res = await recPOST(req);
		expect(res.status).toBe(401);
	});

	it("POST /api/recordings returns 2xx for admin", async () => {
		mockGetRouteAuth.mockResolvedValue({
			sessionClaims: { metadata: { role: "admin" } },
		});
		const req = new NextRequest(new URL("http://localhost:3500/api/recordings"), {
			method: "POST",
			body: JSON.stringify({
				seminarSourceId: "test-seminar-123",
				muxAssetId: "test-asset-456",
				muxPlaybackUrl: "https://image.mux.com/test/low.mp4",
				recordingDate: "2026-02-23T10:00:00Z",
			}),
			headers: { "Content-Type": "application/json" },
		});
		const res = await recPOST(req);
		expect(res.status).toBeGreaterThanOrEqual(200);
		expect(res.status).toBeLessThan(300);
	});
});
