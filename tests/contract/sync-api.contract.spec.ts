// ---------------------------------------------------------------------------
// Contract Tests: Aither Sync API
// Task: T028 [US1] — POST → 202, GET → 200, concurrent POST → 409
// Task: T012 [005-data-sync] — Updated envelope format (success/data/error/meta)
// ---------------------------------------------------------------------------

import { createHemeraClient } from "@/lib/hemera/factory";
import {
	SyncErrorResponseSchema,
	SyncStartedResponseSchema,
	SyncStatusResponseSchema,
} from "@/lib/sync/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock loadConfig
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn(() => ({
		HEMERA_API_BASE_URL: "https://api.hemera.test",
		HEMERA_API_KEY: "test-key-minimum-32-characters-long-for-validation",
		HTML_OUTPUT_DIR: "output",
	})),
}));

// Mock auth — bypass requireAdmin check
vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({
		status: 200,
		body: { sessionClaims: { metadata: { role: "admin" } } },
	}),
}));
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

// Mock modules before importing route
vi.mock("@/lib/hemera/client", () => ({
	HemeraClient: vi.fn().mockImplementation(() => ({
		get: vi.fn().mockResolvedValue([]),
		put: vi.fn(),
	})),
}));

// Mock factory — prevent getTokenManager() from requiring HEMERA_API_KEY env var
vi.mock("@/lib/hemera/factory", () => ({
	createHemeraClient: vi.fn(() => ({
		get: vi.fn().mockResolvedValue([]),
		put: vi.fn().mockResolvedValue({}),
	})),
}));

// Mock orchestrator with DataSyncJob-shaped runDataSync()
vi.mock("@/lib/sync/orchestrator", () => ({
	SyncOrchestrator: vi.fn().mockImplementation(() => ({
		run: vi.fn().mockResolvedValue({
			jobId: "test-job",
			startTime: new Date().toISOString(),
			endTime: new Date().toISOString(),
			status: "success",
			recordsFetched: 0,
			htmlFilesGenerated: 0,
			htmlFilesSkipped: 0,
			recordsTransmitted: 0,
			errors: [],
		}),
		runDataSync: vi.fn().mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(
						() =>
							resolve({
								jobId: "test-job",
								status: "success",
								startTime: new Date().toISOString(),
								endTime: new Date().toISOString(),
								durationMs: 50,
								courseId: null,
								noUpcomingCourse: true,
								participantsFetched: 0,
								filesGenerated: 0,
								filesSkipped: 0,
								errors: [],
							}),
						50,
					),
				),
		),
	})),
}));

// We test the route handlers directly by importing and calling them
import { GET, POST, _resetState } from "@/app/api/sync/route";
import { NextRequest } from "next/server";

const mockCreateHemeraClient = vi.mocked(createHemeraClient);

function createRequest(method: string): NextRequest {
	return new NextRequest(new URL("http://localhost:3000/api/sync"), { method });
}

describe("POST /api/sync", () => {
	beforeEach(() => {
		_resetState();
	});

	it("returns 202 with a valid SyncStartedResponse envelope", async () => {
		const res = await POST(createRequest("POST"));

		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("running");
		expect(body.data.jobId).toBeTruthy();
		expect(body.meta.requestId).toBeTruthy();

		// Validate response shape matches contract
		const parsed = SyncStartedResponseSchema.safeParse(body);
		expect(parsed.success).toBe(true);
	});

	it("returns 409 when a sync is already running", async () => {
		// First call starts sync
		await POST(createRequest("POST"));

		// Second call should get 409
		const res = await POST(createRequest("POST"));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error.code).toBe("SYNC_IN_PROGRESS");

		const parsed = SyncErrorResponseSchema.safeParse(body);
		expect(parsed.success).toBe(true);
	});

	it("returns 500 without leaving a stale running sync when initialization fails", async () => {
		mockCreateHemeraClient.mockRejectedValueOnce(new Error("Hemera down"));

		const failedResponse = await POST(createRequest("POST"));
		expect(failedResponse.status).toBe(500);

		const nextResponse = await POST(createRequest("POST"));
		expect(nextResponse.status).toBe(202);
	});
});

describe("GET /api/sync", () => {
	beforeEach(() => {
		_resetState();
	});

	it("returns 404 when no sync has been executed", async () => {
		const res = await GET(createRequest("GET"));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error.code).toBe("NO_SYNC_JOB");

		const parsed = SyncErrorResponseSchema.safeParse(body);
		expect(parsed.success).toBe(true);
	});

	it("returns 200 with sync status after a sync has been triggered", async () => {
		// Trigger a sync first
		await POST(createRequest("POST"));

		const res = await GET(createRequest("GET"));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.jobId).toBeTruthy();
		expect(["running", "success", "failed"]).toContain(body.data.status);

		const parsed = SyncStatusResponseSchema.safeParse(body);
		expect(parsed.success).toBe(true);
	});
});
