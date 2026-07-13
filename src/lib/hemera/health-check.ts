// ---------------------------------------------------------------------------
// Hemera API Health Check — verifies connectivity on app startup
// ---------------------------------------------------------------------------

import { loadConfig } from "../config";
import { reportError } from "../monitoring/rollbar-official";
import { isSafeFetchUrl } from "../security/url-validation";

const isProduction = process.env.NODE_ENV === "production";
const HEMERA_HEALTH_PATH = "/api/service/courses";

type ProbeMethod = "HEAD" | "GET";

function isMethodNotSupported(status: number): boolean {
	return status === 405 || status === 501;
}

function isRedirectStatus(status: number): boolean {
	return status >= 300 && status < 400;
}

function isReachableStatus(status: number): boolean {
	if (isRedirectStatus(status)) return false;
	return (status >= 200 && status < 300) || status === 401 || status === 403;
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

/**
 * Detect if we're running inside a Docker container.
 * In Docker, `localhost` refers to the container itself, not the host.
 *
 * Exported for testing — tests can override via `setDockerDetectionOverride`.
 */
export function isRunningInDocker(): boolean {
	try {
		const fs = require("node:fs") as typeof import("node:fs");
		if (fs.existsSync("/.dockerenv")) return true;
	} catch {
		// ignore
	}
	try {
		const fs = require("node:fs") as typeof import("node:fs");
		const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
		if (/docker|containerd|kubepods/.test(cgroup)) return true;
	} catch {
		// ignore
	}
	return false;
}

/**
 * Test-only override for `isRunningInDocker`. When set to a boolean, that value
 * is returned instead of performing filesystem detection. Pass `null` to clear.
 */
let dockerDetectionOverride: boolean | null = null;
export function setDockerDetectionOverride(value: boolean | null): void {
	dockerDetectionOverride = value;
}

function detectDocker(): boolean {
	if (dockerDetectionOverride !== null) return dockerDetectionOverride;
	return isRunningInDocker();
}

function candidatePriority(url: string): number {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		const inDocker = detectDocker();

		if (inDocker) {
			// In Docker: host.docker.internal reaches the host machine.
			// localhost/127.0.0.1 would point to the container itself.
			if (hostname === "host.docker.internal") return 0;
			if (isLoopbackHostname(hostname)) return 1;
			return 2;
		}

		// On host: localhost reaches the local machine.
		if (isLoopbackHostname(hostname)) return 0;
		if (hostname === "host.docker.internal") return 1;
		return 2;
	} catch {
		return 3;
	}
}

function orderedCandidates(primaryUrl: string, fallbackUrl?: string): string[] {
	const allCandidates = fallbackUrl ? [primaryUrl, fallbackUrl] : [primaryUrl];
	const uniqueCandidates = Array.from(new Set(allCandidates));
	return uniqueCandidates.sort((a, b) => candidatePriority(a) - candidatePriority(b));
}

async function probe(url: string, method: ProbeMethod, signal: AbortSignal): Promise<Response> {
	if (!isSafeFetchUrl(url)) {
		throw new Error(`Blocked unsafe fetch URL: ${url}`);
	}
	return fetch(url, {
		method,
		signal,
		cache: "no-store",
		redirect: "manual",
		headers: { Accept: "application/json" },
	});
}

/**
 * Check if the Hemera API is reachable by sending a lightweight HEAD request.
 * Logs a warning in dev mode; reports to Rollbar in production.
 */
export async function checkHemeraHealth(): Promise<boolean> {
	let candidates: string[];
	try {
		const config = loadConfig();
		candidates = orderedCandidates(config.HEMERA_API_BASE_URL, config.HEMERA_API_FALLBACK_URL);
	} catch {
		const msg = "Hemera health check skipped: configuration not available";
		console.warn(`⚠ ${msg}`);
		return false;
	}

	for (const baseUrl of candidates) {
		const url = `${baseUrl.replace(/\/+$/, "")}${HEMERA_HEALTH_PATH}`;

		try {
			const signal = AbortSignal.timeout(5000);
			const headRes = await probe(url, "HEAD", signal);

			if (isReachableStatus(headRes.status)) {
				console.log(`✓ Hemera API reachable at ${baseUrl}`);
				return true;
			}

			if (isMethodNotSupported(headRes.status)) {
				const getRes = await probe(url, "GET", signal);
				if (isReachableStatus(getRes.status)) {
					console.log(`✓ Hemera API reachable at ${baseUrl} (GET fallback)`);
					return true;
				}
			}
		} catch {
			// Try next candidate URL
		}
	}

	handleFailure("Hemera API is unreachable for all configured URLs");
	return false;
}

function handleFailure(message: string): void {
	console.error(`✗ ${message}`);

	if (isProduction) {
		reportError(new Error(message), undefined, "warning");
	}
}
