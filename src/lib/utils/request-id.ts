// ---------------------------------------------------------------------------
// Request ID utilities for tracking requests across the application
// Ported from hemera — RFC4122 v4 UUID generation with fallback chain
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

interface GlobalWithCrypto {
	crypto?: {
		randomUUID?: () => string;
		getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
	};
}

/**
 * Generate a unique request ID (RFC4122 v4 UUID preferred)
 */
export function generateRequestId(): string {
	try {
		if (
			typeof globalThis !== "undefined" &&
			(globalThis as GlobalWithCrypto).crypto &&
			typeof (globalThis as GlobalWithCrypto).crypto?.randomUUID === "function"
		) {
			const uuid = (globalThis as GlobalWithCrypto).crypto?.randomUUID?.();
			if (uuid) return uuid;
		}
	} catch {
		// fall through to fallback
	}

	// Fallback: RFC4122 v4 using crypto.getRandomValues if available, else node:crypto randomBytes
	const getBytes = (): Uint8Array => {
		if (
			typeof globalThis !== "undefined" &&
			(globalThis as GlobalWithCrypto).crypto &&
			typeof (globalThis as GlobalWithCrypto).crypto?.getRandomValues === "function"
		) {
			const buf = new Uint8Array(16);
			(globalThis as GlobalWithCrypto).crypto?.getRandomValues?.(buf);
			return buf;
		}
		// Cryptographically secure fallback (no Math.random)
		return randomBytes(16);
	};

	const b = getBytes();
	const b6 = b[6];
	const b8 = b[8];
	if (b6 !== undefined && b8 !== undefined) {
		b[6] = (b6 & 0x0f) | 0x40; // version 4
		b[8] = (b8 & 0x3f) | 0x80; // variant 10xxxxxx
	}
	const toHex = (n: number) => n.toString(16).padStart(2, "0");
	const hex = Array.from(b).map(toHex).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Extract request ID from NextRequest or generate a new one.
 * Inbound x-request-id is treated as an external correlation ID only.
 */
export function getOrCreateRequestId(_request: NextRequest): string {
	return generateRequestId();
}

/**
 * Extract request ID from headers or generate a new one
 */
export function getOrCreateRequestIdFromHeaders(_headers: Headers): string {
	return generateRequestId();
}

/**
 * Retrieve an external/inbound request ID from headers if present.
 * For correlation only — not used as canonical ID.
 */
export function getExternalRequestIdFromHeaders(headers: Headers): string | undefined {
	return headers.get("x-request-id") || headers.get("x-trace-id") || undefined;
}

/**
 * Request context interface
 */
export interface RequestContext {
	id: string;
	timestamp: string;
	method: string;
	url: string;
	/** Inbound correlation id provided by upstream (x-request-id or x-trace-id) */
	externalId?: string;
	userAgent?: string;
	ip?: string;
}

/**
 * Create request context manually
 */
export function createRequestContext(
	requestId: string,
	method?: string,
	url?: string,
	userAgent?: string,
	ip?: string,
): RequestContext {
	return {
		id: requestId,
		timestamp: new Date().toISOString(),
		method: method || "UNKNOWN",
		url: url || "unknown",
		userAgent,
		ip,
	};
}

/**
 * Create request context from NextRequest object
 */
export function createRequestContextFromNextRequest(
	request: NextRequest,
	requestId?: string,
): RequestContext {
	const id = requestId || getOrCreateRequestId(request);
	const externalId = getExternalRequestIdFromHeaders(request.headers);

	return {
		id,
		timestamp: new Date().toISOString(),
		method: request.method,
		url: request.url,
		externalId,
		userAgent: request.headers.get("user-agent") || undefined,
		ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
	};
}
