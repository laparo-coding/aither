// ---------------------------------------------------------------------------
// Uranos Service Auth Guard (Spec 009)
// Task: T015 — requireUranosAccess: token-or-admin gate mirroring Gaia's
//               requireSyncAccess. Validates bearer token against
//               URANOS_SYNC_TOKEN via timing-safe comparison, with admin
//               session fallback.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { requireAdmin } from "./role-check";
import { timingSafeEqualString } from "./timing-safe";

// ── Helpers ────────────────────────────────────────────────────────────────

function extractBearerToken(headers: Headers): string | null {
	const authorization = headers.get("authorization");
	if (!authorization) {
		return null;
	}

	const [scheme, token] = authorization.split(" ", 2);
	if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
		return null;
	}

	return token;
}

function isValidUranosToken(token: string | null): boolean {
	const expectedToken = process.env.URANOS_SYNC_TOKEN;
	if (!token || !expectedToken) {
		return false;
	}

	return timingSafeEqualString(token, expectedToken);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Require Uranos service authentication for an API endpoint.
 *
 * Auth flow (mirrors requireSyncAccess for Gaia):
 * 1. If a Bearer token is present, validate it against URANOS_SYNC_TOKEN.
 *    - Valid → authorized (200).
 *    - Invalid → 401 UNAUTHORIZED.
 * 2. If no Bearer token, fall back to admin session check via requireAdmin.
 *    - Admin → authorized (200).
 *    - Non-admin → 403 FORBIDDEN.
 *    - No session → 401 UNAUTHORIZED.
 *
 * @returns { status: 200, body } if authorized, or { status, body } with error.
 */
export function requireUranosAccess(
	request: NextRequest,
	auth: unknown,
): { status: number; body: unknown } {
	const expectedTokenConfigured = !!process.env.URANOS_SYNC_TOKEN;
	const authorization = request.headers.get("authorization");
	if (authorization) {
		const bearerToken = extractBearerToken(request.headers);
		if (isValidUranosToken(bearerToken)) {
			return {
				status: 200,
				body: { authMethod: "service-token", service: "uranos" },
			};
		}

		return { status: 401, body: { error: "UNAUTHORIZED" } };
	}

	// FR-018a: if URANOS_SYNC_TOKEN is unset, all non-admin requests are 401.
	// Admin fallback remains available.
	if (!expectedTokenConfigured) {
		const adminResult = requireAdmin(auth);
		if (adminResult.status === 200) {
			return adminResult;
		}
		return { status: 401, body: { error: "UNAUTHORIZED" } };
	}

	// No bearer token → fall back to admin session
	const adminResult = requireAdmin(auth);
	if (adminResult.status === 200) {
		return adminResult;
	}

	// Distinguish 401 (no session) from 403 (non-admin session)
	if (adminResult.status === 401) {
		return { status: 401, body: { error: "UNAUTHORIZED" } };
	}

	// requireAdmin returns 403 for non-admin authenticated sessions
	return { status: 403, body: { error: "FORBIDDEN" } };
}
