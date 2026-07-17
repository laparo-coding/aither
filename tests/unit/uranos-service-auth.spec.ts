// ---------------------------------------------------------------------------
// Unit Tests: Uranos Service Auth Guard (Spec 009)
// Task: T009 — valid token → 200, invalid/missing token → 401,
//               admin session fallback → 200, non-admin → 403,
//               no secret leakage.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_TOKEN = "valid-uranos-token-0123456789abcdef0123456789abcdef";

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn(),
}));

function createRequest(headers: Record<string, string> = {}): NextRequest {
	return new NextRequest(new URL("http://localhost:3001/api/recording/timestamp"), {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
	});
}

describe("requireUranosAccess", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.URANOS_SYNC_TOKEN = VALID_TOKEN;
	});

	it("returns 200 for a valid bearer token", async () => {
		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest({ Authorization: `Bearer ${VALID_TOKEN}` });
		const result = requireUranosAccess(req, null);
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({ authMethod: "service-token", service: "uranos" });
	});

	it("returns 401 for an invalid bearer token", async () => {
		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest({ Authorization: "Bearer wrong-token" });
		const result = requireUranosAccess(req, null);
		expect(result.status).toBe(401);
	});

	it("returns 401 when no Authorization header and no session", async () => {
		const { requireAdmin } = await import("@/lib/auth/role-check");
		vi.mocked(requireAdmin).mockReturnValue({ status: 401, body: { error: "UNAUTHENTICATED" } });

		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest();
		const result = requireUranosAccess(req, null);
		expect(result.status).toBe(401);
	});

	it("returns 200 for an admin session (fallback)", async () => {
		const { requireAdmin } = await import("@/lib/auth/role-check");
		vi.mocked(requireAdmin).mockReturnValue({
			status: 200,
			body: { sessionClaims: { metadata: { role: "admin" } } },
		});

		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest();
		const result = requireUranosAccess(req, { sessionClaims: { metadata: { role: "admin" } } });
		expect(result.status).toBe(200);
	});

	it("returns 403 for an authenticated non-admin session", async () => {
		const { requireAdmin } = await import("@/lib/auth/role-check");
		vi.mocked(requireAdmin).mockReturnValue({ status: 403, body: { error: "FORBIDDEN" } });

		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest();
		const result = requireUranosAccess(req, {
			userId: "user_123",
			sessionClaims: { metadata: { role: "participant" } },
		});
		expect(result.status).toBe(403);
	});

	it("returns 401 when URANOS_SYNC_TOKEN is unset and no session", async () => {
		// biome-ignore lint/performance/noDelete: intentionally removes key to test truly-unset path
		delete process.env.URANOS_SYNC_TOKEN;

		const { requireAdmin } = await import("@/lib/auth/role-check");
		vi.mocked(requireAdmin).mockReturnValue({ status: 401, body: { error: "UNAUTHENTICATED" } });

		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest({ Authorization: "Bearer some-token" });
		const result = requireUranosAccess(req, null);
		expect(result.status).toBe(401);
	});

	it("does not leak the token in the response body", async () => {
		const { requireUranosAccess } = await import("@/lib/auth/uranos-service-auth");
		const req = createRequest({ Authorization: `Bearer ${VALID_TOKEN}` });
		const result = requireUranosAccess(req, null);
		const bodyStr = JSON.stringify(result.body);
		expect(bodyStr).not.toContain(VALID_TOKEN);
	});
});
