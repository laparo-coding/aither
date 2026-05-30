import { isAuthorizedSyncServiceRequest } from "@/proxy";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

function createRequest(pathname: string, authorization?: string): NextRequest {
	return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
		headers: authorization ? { authorization } : undefined,
	});
}

describe("isAuthorizedSyncServiceRequest", () => {
	afterEach(() => {
		process.env.AITHER_SYNC_TOKEN = "";
	});

	it("returns true for /api/sync with a valid bearer token", () => {
		process.env.AITHER_SYNC_TOKEN = "valid-sync-token";

		const request = createRequest("/api/sync", "Bearer valid-sync-token");

		expect(isAuthorizedSyncServiceRequest(request)).toBe(true);
	});

	it("returns false for /api/sync with an invalid bearer token", () => {
		process.env.AITHER_SYNC_TOKEN = "valid-sync-token";

		const request = createRequest("/api/sync", "Bearer wrong-token");

		expect(isAuthorizedSyncServiceRequest(request)).toBe(false);
	});

	it("returns false for /api/sync without a configured sync token", () => {
		const request = createRequest("/api/sync", "Bearer valid-sync-token");

		expect(isAuthorizedSyncServiceRequest(request)).toBe(false);
	});

	it("returns false for non-sync routes even with a valid bearer token", () => {
		process.env.AITHER_SYNC_TOKEN = "valid-sync-token";

		const request = createRequest("/api/recordings", "Bearer valid-sync-token");

		expect(isAuthorizedSyncServiceRequest(request)).toBe(false);
	});
});
