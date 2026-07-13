// ---------------------------------------------------------------------------
// URL validation for SSRF prevention
// Ensures user/config-controlled URLs are safe to fetch (http/https only,
// no internal metadata endpoints, no non-HTTP protocols).
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
	"169.254.169.254", // AWS/GCP/Azure metadata endpoint
	"metadata.google.internal", // GCP metadata
	"0.0.0.0",
	"[::]", // IPv6 any
	"[::1]", // IPv6 loopback
]);

/**
 * Validate that a URL is safe to fetch (SSRF prevention).
 * - Must be http or https
 * - Must not point to cloud metadata endpoints
 * - Must have a hostname
 *
 * @returns true if the URL is safe to fetch
 */
export function isSafeFetchUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		if (!parsed.hostname) return false;
		if (BLOCKED_HOSTNAMES.has(parsed.hostname.toLowerCase())) return false;
		return true;
	} catch {
		return false;
	}
}

/**
 * Validate that a URL is a same-origin relative path (no protocol/host).
 * Used for client-side fetch calls that should only target the app's own API.
 */
export function isSameOriginRelativeUrl(url: string): boolean {
	try {
		const parsed = new URL(url, "http://localhost");
		// If the URL has a host, it's absolute — reject unless same-origin
		// For relative URLs, URL() will use the base's host
		if (parsed.host !== "localhost") return false;
		// Must start with / (relative path)
		return url.startsWith("/");
	} catch {
		return false;
	}
}
