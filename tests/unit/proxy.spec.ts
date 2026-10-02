import { getRouteAuth } from "@/lib/auth/route-auth";
import middleware, {
	isAuthorizedSyncServiceRequest,
	isClerkAuthBypassedPath,
	isDevAuthBypassEnabled,
} from "@/proxy";
import { type NextFetchEvent, NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

function createRequest(pathname: string, authorization?: string): NextRequest {
	return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
		headers: authorization ? { authorization } : undefined,
	});
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("development auth bypass", () => {
	it("allows protected routes only when explicitly enabled without a Clerk key in development", async () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
		vi.stubEnv("ENABLE_DEV_AUTH_BYPASS", "true");

		expect(isDevAuthBypassEnabled()).toBe(true);

		const response = await middleware(
			createRequest("/recording/player/test"),
			{} as NextFetchEvent,
		);
		expect(response.headers.get("x-middleware-next")).toBe("1");
	});

	it("does not bypass protected routes in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
		vi.stubEnv("ENABLE_DEV_AUTH_BYPASS", "true");

		expect(isDevAuthBypassEnabled()).toBe(false);

		const response = await middleware(
			createRequest("/recording/player/test"),
			{} as NextFetchEvent,
		);
		expect(response.status).toBe(503);
	});

	it("explicitly bypasses Clerk when enabled in development and returns the mock admin session", async () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_configured");
		vi.stubEnv("ENABLE_DEV_AUTH_BYPASS", "true");

		expect(isDevAuthBypassEnabled()).toBe(true);

		const response = await middleware(
			createRequest("/recording/player/test"),
			{} as NextFetchEvent,
		);
		expect(response.headers.get("x-middleware-next")).toBe("1");
		await expect(getRouteAuth()).resolves.toMatchObject({
			sessionClaims: { metadata: { role: "admin" } },
		});
	});

	it("does not bypass authentication in development without the flag", async () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
		vi.stubEnv("ENABLE_DEV_AUTH_BYPASS", "false");

		expect(isDevAuthBypassEnabled()).toBe(false);
		const response = await middleware(
			createRequest("/recording/player/test"),
			{} as NextFetchEvent,
		);
		expect(response.status).toBe(503);
	});
});

describe("isAuthorizedSyncServiceRequest", () => {
	afterEach(() => {
		process.env.AITHER_SYNC_TOKEN = "";
	});

	describe("service-key routes bypass Clerk only at exact route scope", () => {
		it("exempts the document access and recording deletion handlers from Clerk", () => {
			expect(isClerkAuthBypassedPath("/api/service/seminar-document-access")).toBe(true);
			expect(isClerkAuthBypassedPath("/api/service/seminar-recordings/rec_123")).toBe(true);
		});

		it("does not exempt neighboring service routes", () => {
			expect(isClerkAuthBypassedPath("/api/service/bookings/booking-1")).toBe(false);
			expect(isClerkAuthBypassedPath("/api/service/seminar-recordings/rec_123/extra")).toBe(false);
			expect(isClerkAuthBypassedPath("/api/service/seminar-document-access-extra")).toBe(false);
		});
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
