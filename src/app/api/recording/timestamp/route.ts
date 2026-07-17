// ---------------------------------------------------------------------------
// POST /api/recording/timestamp — Uranos Timestamp Ingestion (Spec 009)
// Task: T018/T019/T021/T023/T024/T025/T026
//
// Accepts a unix timestamp from the Uranos app, appends it as an ffmpeg
// chapter to the active recording's ffmetadata JSON, and upserts the
// document to Vercel Blob Storage.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { requireUranosAccess } from "@/lib/auth/uranos-service-auth";
import { ErrorSeverity, reportError } from "@/lib/monitoring/rollbar-official";
import {
	appendChapter,
	computeOffsetMicros,
	createDocument,
	validateOffset,
} from "@/lib/recording/ffmetadata";
import {
	BlobStorageError,
	getBlobPath,
	readFFMetadata,
	writeFFMetadata,
} from "@/lib/recording/ffmetadata-blob";
import { withAssetLock } from "@/lib/recording/ffmetadata-lock";
import { TimestampRequestSchema } from "@/lib/recording/schemas";
import { getSessionState, isRecording } from "@/lib/recording/session-manager";
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "@/lib/utils/api-response";
import type { NextRequest } from "next/server";

// ── Rate Limiter (fixed-window, per-instance, in-memory) ───────────────────
// NOTE: Per FR-016/FR-019, the rate limiter is intentionally per-instance and
// in-memory because the active recording (FFmpeg capture) runs on a single
// instance. If multi-instance deployment is introduced, this must be replaced
// with a centralized atomic counter (e.g., Upstash Redis) keyed by identity.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

interface RateLimitEntry {
	count: number;
	windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(identity: string): { allowed: boolean; retryAfterSeconds: number } {
	const now = Date.now();
	const entry = rateLimitMap.get(identity);

	if (!entry || now >= entry.windowStart + RATE_LIMIT_WINDOW_MS) {
		// New window
		rateLimitMap.set(identity, { count: 1, windowStart: now });
		return { allowed: true, retryAfterSeconds: 0 };
	}

	if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
		// Rate limited — rejected requests do NOT consume quota (FR-019)
		const retryAfterMs = entry.windowStart + RATE_LIMIT_WINDOW_MS - now;
		return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
	}

	// Within quota
	entry.count++;
	return { allowed: true, retryAfterSeconds: 0 };
}

function extractIdentity(
	request: NextRequest,
	authResult: { status: number; body: unknown },
): string {
	// If token-authenticated, use the token as the key
	const authorization = request.headers.get("authorization");
	if (authorization) {
		const token = authorization.split(" ", 2)[1];
		if (token) return `token:${token}`;
	}

	// Otherwise, use the userId from the auth body (admin fallback)
	const body = authResult.body as { userId?: string } | undefined;
	return `user:${body?.userId ?? "unknown"}`;
}

// ── POST Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
	const requestId = req.headers.get("x-request-id") ?? randomUUID();

	// 1. Authentication (FR-003)
	const authData = await getRouteAuth();
	const authResult = requireUranosAccess(req, authData);
	if (authResult.status !== 200) {
		return createErrorResponse(
			authResult.status === 401 ? "Authentication required" : "Insufficient permissions",
			authResult.status === 401 ? ErrorCodes.UNAUTHORIZED : ErrorCodes.FORBIDDEN,
			requestId,
			authResult.status,
		);
	}

	// 2. Rate limit check (FR-019, FR-024 — before active-recording check)
	const identity = extractIdentity(req, authResult);
	const rateLimit = checkRateLimit(identity);
	if (!rateLimit.allowed) {
		const response = createErrorResponse(
			"Rate limit exceeded",
			ErrorCodes.TOO_MANY_REQUESTS,
			requestId,
			429,
		);
		response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
		return response;
	}

	// 3. Parse and validate request body (FR-002)
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return createErrorResponse("Invalid JSON body", ErrorCodes.INVALID_REQUEST, requestId, 400);
	}

	const parsed = TimestampRequestSchema.safeParse(body);
	if (!parsed.success) {
		return createErrorResponse("Invalid request body", ErrorCodes.INVALID_REQUEST, requestId, 400, {
			issues: parsed.error.issues,
		});
	}

	const { timestamp } = parsed.data;

	// 4. Active recording check (FR-004, FR-024 — after rate limit)
	if (!isRecording()) {
		return createErrorResponse(
			"No active recording session",
			ErrorCodes.NO_ACTIVE_RECORDING,
			requestId,
			404,
		);
	}

	const session = getSessionState();
	if (!session) {
		return createErrorResponse(
			"No active recording session",
			ErrorCodes.NO_ACTIVE_RECORDING,
			requestId,
			404,
		);
	}

	// 5. Compute offset (FR-011)
	const offsetMicros = computeOffsetMicros(session.startedAt, timestamp);

	// 6. Validate offset (FR-012 — pre-start rejection)
	const offsetError = validateOffset(offsetMicros);
	if (offsetError) {
		return createErrorResponse(offsetError.message, ErrorCodes.INVALID_TIMESTAMP, requestId, 400);
	}

	// 7. Read-modify-write inside per-asset-id lock (FR-016, FR-025)
	const assetId = session.sessionId;

	try {
		const result = await withAssetLock(assetId, async () => {
			// Read existing blob (FR-013)
			const readResult = await readFFMetadata(assetId);

			let doc: import("@/lib/recording/types").FFMetadataJSON;
			let chapterId: number;

			if (readResult.corrupt) {
				// Corrupt blob → discard and start fresh (FR-023)
				doc = createDocument(assetId, offsetMicros);
				chapterId = 0;
			} else if (readResult.doc === null) {
				// No existing blob → create new document (FR-007)
				doc = createDocument(assetId, offsetMicros);
				chapterId = 0;
			} else {
				// Existing blob → append chapter (FR-008, FR-012a, FR-022)
				const appendResult = appendChapter(readResult.doc, offsetMicros);
				if (!appendResult.ok) {
					throw appendResult.error;
				}
				doc = appendResult.doc;
				chapterId = appendResult.chapterId;
			}

			// Write (upsert) the blob — state advances only after successful write (FR-021)
			await writeFFMetadata(assetId, doc);

			return {
				doc,
				chapterId,
				blobKey: getBlobPath(assetId),
				isRetry:
					readResult.doc !== null &&
					chapterId === (readResult.doc.chapters[readResult.doc.chapters.length - 1]?.id ?? -1),
			};
		});

		// 8. Return success (FR-001)
		return createSuccessResponse(
			{
				assetId,
				chapterId: result.chapterId,
				blobKey: result.blobKey,
			},
			requestId,
			200,
		);
	} catch (err) {
		// Handle typed errors from appendChapter
		if (err && typeof err === "object" && "kind" in err) {
			const ffError = err as { kind: string; message: string };
			if (ffError.kind === "INVALID_TIMESTAMP") {
				return createErrorResponse(ffError.message, ErrorCodes.INVALID_TIMESTAMP, requestId, 400);
			}
			if (ffError.kind === "INVALID_REQUEST") {
				return createErrorResponse(ffError.message, ErrorCodes.INVALID_REQUEST, requestId, 400);
			}
		}

		// Handle blob storage errors (FR-015, FR-018)
		if (err instanceof BlobStorageError) {
			reportError(
				err,
				{ requestId, route: "/api/recording/timestamp", method: "POST" },
				ErrorSeverity.ERROR,
			);
			return createErrorResponse(
				"Blob storage operation failed",
				ErrorCodes.BLOB_STORAGE_UNAVAILABLE,
				requestId,
				503,
			);
		}

		// 9. Internal error (FR-017)
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{ requestId, route: "/api/recording/timestamp", method: "POST" },
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"An unexpected error occurred",
			ErrorCodes.INTERNAL_ERROR,
			requestId,
			500,
		);
	}
}
