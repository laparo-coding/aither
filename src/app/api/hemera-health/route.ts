import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Lightweight probe to check if the Hemera API is reachable.
 *
 * Hemera returns JSON for `/api/service/courses`. We perform a GET (not HEAD,
 * which would be rejected by 401-protected APIs anyway) and validate that the
 * upstream actually speaks the Hemera protocol — i.e. responds with JSON and
 * an API-style status code. This avoids falsely reporting "reachable" when
 * something else (e.g. another Next.js instance) is listening on the same URL.
 *
 * Returns 200 if Hemera responds with JSON, 502 otherwise.
 */
export async function HEAD() {
	const baseUrl = process.env.HEMERA_API_BASE_URL;
	if (!baseUrl) {
		return new NextResponse(null, { status: 502 });
	}

	try {
		const apiKey = process.env.HEMERA_API_KEY;
		const headers: Record<string, string> = { Accept: "application/json" };
		if (apiKey) {
			headers["X-API-Key"] = apiKey;
		}
		const res = await fetch(`${baseUrl}/api/service/courses`, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(4_000),
			cache: "no-store",
		});
		const contentType = res.headers.get("content-type") ?? "";
		const looksLikeJson = contentType.includes("application/json");
		// 2xx = authenticated OK; 401 = reachable, auth invalid (still valid Hemera).
		// 404/5xx with HTML = something other than Hemera answered.
		const looksLikeApi = res.ok || res.status === 401;
		if (looksLikeApi && looksLikeJson) {
			return new NextResponse(null, { status: 200 });
		}
		return new NextResponse(null, { status: 502 });
	} catch {
		return new NextResponse(null, { status: 502 });
	}
}
