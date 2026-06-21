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
 * - HEAD: returns 200 if Hemera responds, 502 otherwise (no body)
 * - GET: returns JSON with `{ reachable, baseUrl, hemeraStatus, error? }`
 */

interface ProbeResult {
	reachable: boolean;
	baseUrl?: string;
	hemeraStatus?: number;
	error?: string;
}

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_ATTEMPTS = 2;

function collectCandidateBaseUrls(): string[] {
	const baseUrl = process.env.HEMERA_API_BASE_URL;
	const fallbackUrl = process.env.HEMERA_API_FALLBACK_URL;
	const candidates = [baseUrl, fallbackUrl].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	);

	return Array.from(new Set(candidates));
}

async function probeHemera(): Promise<{ result: ProbeResult; status: number }> {
	const candidates = collectCandidateBaseUrls();
	if (candidates.length === 0) {
		return {
			result: {
				reachable: false,
				error: "HEMERA_API_BASE_URL/HEMERA_API_FALLBACK_URL not configured",
			},
			status: 502,
		};
	}

	const apiKey = process.env.HEMERA_API_KEY;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (apiKey) {
		headers["X-API-Key"] = apiKey;
	}

	let lastError = "Hemera probe failed for all configured URLs";

	for (const baseUrl of candidates) {
		for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt += 1) {
			try {
				const res = await fetch(`${baseUrl}/api/service/courses`, {
					method: "GET",
					headers,
					signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
					cache: "no-store",
				});
				const contentType = res.headers.get("content-type") ?? "";
				const looksLikeJson = contentType.includes("application/json");
				// 2xx = authenticated OK; 401 = reachable, auth invalid (still valid Hemera).
				// 404/5xx with HTML = something other than Hemera answered.
				const looksLikeApi = res.ok || res.status === 401;
				if (looksLikeApi && looksLikeJson) {
					return {
						result: { reachable: true, baseUrl, hemeraStatus: res.status },
						status: 200,
					};
				}

				lastError = `Unexpected response from ${baseUrl} (status=${res.status}, contentType=${contentType || "none"})`;
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}

			if (attempt < PROBE_MAX_ATTEMPTS) {
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
		}
	}

	return {
		result: {
			reachable: false,
			baseUrl: candidates[0],
			error: lastError,
		},
		status: 502,
	};
}

export async function HEAD() {
	const { status } = await probeHemera();
	return new NextResponse(null, { status });
}

export async function GET() {
	const { result, status } = await probeHemera();
	return NextResponse.json(result, { status });
}
