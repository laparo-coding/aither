import type { NextRequest } from "next/server";

import { requireAdmin } from "./role-check";
import { timingSafeEqualString } from "./timing-safe";

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

function isValidSyncServiceToken(token: string | null): boolean {
	const expectedToken = process.env.AITHER_SYNC_TOKEN;
	if (!token || !expectedToken) {
		return false;
	}

	return timingSafeEqualString(token, expectedToken);
}

export function requireSyncAccess(
	request: NextRequest,
	auth: unknown,
): { status: number; body: unknown } {
	const authorization = request.headers.get("authorization");
	if (authorization) {
		const bearerToken = extractBearerToken(request.headers);
		if (isValidSyncServiceToken(bearerToken)) {
			return {
				status: 200,
				body: { authMethod: "service-token", service: "gaia" },
			};
		}

		return { status: 401, body: { error: "UNAUTHENTICATED" } };
	}

	return requireAdmin(auth);
}
