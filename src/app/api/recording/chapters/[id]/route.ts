// ---------------------------------------------------------------------------
// POST /api/recording/chapters/[id] — Regenerate Chaptered Video (Spec 010)
// Task: T016 — Auth guard, validate assetId, check recording exists,
//               check recording not active, read ffmetadata blob,
//               validate JSON, get video duration, remux, validate chapter
//               count, upload to MUX, delete transient file, return 200.
// Task: T017 — Idempotent re-upload (overwrite existing MUX chaptered asset).
// Task: T018 — Rollbar error logging for all failure paths (no secrets).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import { getRouteAuth } from "@/lib/auth/route-auth";
import { requireUranosAccess } from "@/lib/auth/uranos-service-auth";
import { loadConfig } from "@/lib/config";
import { ErrorSeverity, reportError } from "@/lib/monitoring/rollbar-official";
import { extractChapters } from "@/lib/recording/chapter-extractor";
import {
	getChapteredAssetMapping,
	storeChapteredAssetMapping,
} from "@/lib/recording/chaptered-asset-mapping";
import { BlobStorageError, readFFMetadata } from "@/lib/recording/ffmetadata-blob";
import { RemuxFailedError, remuxWithChapters } from "@/lib/recording/ffmpeg-remux";
import { getDuration, resolveFilePath } from "@/lib/recording/file-manager";
import { uploadToMux } from "@/lib/recording/mux-uploader";
import { FFMetadataJSONSchema } from "@/lib/recording/schemas";
import { getSessionState, isRecording } from "@/lib/recording/session-manager";
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "@/lib/utils/api-response";
import type { NextRequest } from "next/server";

const SESSION_ID_PATTERN = /^rec_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

function validateAssetId(id: string): boolean {
	return SESSION_ID_PATTERN.test(id);
}

function getTransientOutputPath(assetId: string): string {
	const config = loadConfig();
	const outputDir = config.RECORDINGS_OUTPUT_DIR ?? "output/recordings";
	return join(outputDir, `${assetId}.chapters.mp4`);
}

async function countChaptersViaFfprobe(filePath: string): Promise<number> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	const { stdout } = await execFileAsync("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format_tags",
		"-show_chapters",
		"-of",
		"json",
		filePath,
	]);
	const parsed = JSON.parse(stdout) as { chapters?: unknown[] };
	return parsed.chapters?.length ?? 0;
}

// ── POST Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const requestId = req.headers.get("x-request-id") ?? randomUUID();
	const { id: assetId } = await params;

	// 1. Authentication (FR-019)
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

	// 2. Validate assetId (400 INVALID_REQUEST)
	if (!validateAssetId(assetId)) {
		return createErrorResponse(
			"Invalid assetId format",
			ErrorCodes.INVALID_REQUEST,
			requestId,
			400,
		);
	}

	// 3. Check recording not active (409 RECORDING_IN_PROGRESS, FR-005)
	if (isRecording()) {
		const session = getSessionState();
		if (session?.sessionId === assetId) {
			return createErrorResponse(
				"Cannot regenerate while recording is still active",
				ErrorCodes.RECORDING_IN_PROGRESS,
				requestId,
				409,
			);
		}
	}

	// 4. Check raw recording exists (404 RECORDING_NOT_FOUND, FR-006)
	const rawMp4Path = await resolveFilePath(assetId);
	if (!rawMp4Path) {
		return createErrorResponse(
			"No recording found for assetId",
			ErrorCodes.RECORDING_NOT_FOUND,
			requestId,
			404,
		);
	}

	// 5. Read ffmetadata blob (404 FFMETADATA_NOT_FOUND / 503 BLOB_STORAGE_UNAVAILABLE, FR-003/FR-006)
	let ffmetadataJson: unknown;
	try {
		const readResult = await readFFMetadata(assetId);
		if (readResult.corrupt) {
			return createErrorResponse(
				"ffmetadata JSON blob is corrupt",
				ErrorCodes.FFMETADATA_INVALID,
				requestId,
				422,
			);
		}
		if (readResult.doc === null) {
			return createErrorResponse(
				"No ffmetadata JSON blob found for assetId",
				ErrorCodes.FFMETADATA_NOT_FOUND,
				requestId,
				404,
			);
		}
		ffmetadataJson = readResult.doc;
	} catch (err) {
		if (err instanceof BlobStorageError) {
			reportError(
				err,
				{
					requestId,
					route: "/api/recording/chapters",
					method: "POST",
					additionalData: { assetId },
				},
				ErrorSeverity.ERROR,
			);
			return createErrorResponse(
				"Vercel Blob Storage temporarily unavailable",
				ErrorCodes.BLOB_STORAGE_UNAVAILABLE,
				requestId,
				503,
			);
		}
		throw err;
	}

	// 6. Validate ffmetadata JSON (422 FFMETADATA_INVALID, FR-004)
	const parsed = FFMetadataJSONSchema.safeParse(ffmetadataJson);
	if (!parsed.success) {
		return createErrorResponse(
			"ffmetadata JSON failed schema validation",
			ErrorCodes.FFMETADATA_INVALID,
			requestId,
			422,
			{ issues: parsed.error.issues },
		);
	}
	const doc = parsed.data;

	// 7. Get video duration via ffprobe (FR-008)
	let videoDurationSeconds: number;
	try {
		videoDurationSeconds = await getDuration(rawMp4Path);
	} catch (err) {
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"Failed to determine video duration",
			ErrorCodes.REMUX_FAILED,
			requestId,
			502,
		);
	}
	const videoDurationMicros = Math.floor(videoDurationSeconds * 1_000_000);

	// 8. Remux with chapters (502 REMUX_FAILED, FR-009)
	const transientOutputPath = getTransientOutputPath(assetId);
	try {
		await remuxWithChapters(doc, {
			assetId,
			rawMp4Path,
			outputPath: transientOutputPath,
			videoDurationMicros,
		});
	} catch (err) {
		const stderr = err instanceof RemuxFailedError ? err.stderr : "";
		const exitCode = err instanceof RemuxFailedError ? err.exitCode : null;
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId, ffmpegExitCode: exitCode, stderr },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"FFmpeg remux failed or chapter validation failed",
			ErrorCodes.REMUX_FAILED,
			requestId,
			502,
		);
	}

	// 9. Validate output chapter count via ffprobe (502 REMUX_FAILED on mismatch, FR-020)
	let embeddedChapterCount: number;
	try {
		embeddedChapterCount = await countChaptersViaFfprobe(transientOutputPath);
	} catch (err) {
		await unlink(transientOutputPath).catch(() => {});
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"FFmpeg remux failed or chapter validation failed",
			ErrorCodes.REMUX_FAILED,
			requestId,
			502,
		);
	}

	if (embeddedChapterCount !== doc.chapters.length) {
		await unlink(transientOutputPath).catch(() => {});
		reportError(
			new Error(
				`Chapter count mismatch: ffmetadata=${doc.chapters.length}, embedded=${embeddedChapterCount}`,
			),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"FFmpeg remux failed or chapter validation failed",
			ErrorCodes.REMUX_FAILED,
			requestId,
			502,
		);
	}

	// 10. Upload to MUX (idempotent re-upload overwrites existing MUX chaptered asset, FR-010/FR-009)
	let muxAssetId: string;
	let muxPlaybackUrl: string;
	try {
		const uploadResult = await uploadToMux(transientOutputPath);
		muxAssetId = uploadResult.muxAssetId;
		muxPlaybackUrl = uploadResult.muxPlaybackUrl;
	} catch (err) {
		await unlink(transientOutputPath).catch(() => {});
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"FFmpeg remux failed or chapter validation failed",
			ErrorCodes.REMUX_FAILED,
			requestId,
			502,
		);
	}

	// 11. Delete transient local file (Constitution Principle VIII, FR-009)
	await unlink(transientOutputPath).catch((err: unknown) => {
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId },
			},
			ErrorSeverity.WARNING,
		);
	});

	// 12. Store assetId → MUX chaptered asset mapping (stateless, Vercel Blob)
	try {
		await storeChapteredAssetMapping({
			assetId,
			muxAssetId,
			muxPlaybackUrl,
			chapterCount: embeddedChapterCount,
			generatedAt: new Date().toISOString(),
		});
	} catch (err) {
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "POST",
				additionalData: { assetId, muxAssetId },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"Failed to persist chaptered asset mapping",
			ErrorCodes.INTERNAL_ERROR,
			requestId,
			500,
		);
	}

	// 13. Return 200 with ChapterRegenerationResult (FR-001)
	return createSuccessResponse(
		{
			assetId,
			muxAssetId,
			chapterCount: embeddedChapterCount,
		},
		requestId,
		200,
	);
}

// ── GET Handler (T026) — List chapters for a chaptered asset ───────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const requestId = req.headers.get("x-request-id") ?? randomUUID();
	const { id: assetId } = await params;

	// 1. Authentication (FR-019)
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

	// 2. Validate assetId (400 INVALID_REQUEST)
	if (!validateAssetId(assetId)) {
		return createErrorResponse(
			"Invalid assetId format",
			ErrorCodes.INVALID_REQUEST,
			requestId,
			400,
		);
	}

	// 3. Retrieve chaptered asset mapping (404 CHAPTERS_NOT_GENERATED, FR-013)
	let mapping: Awaited<ReturnType<typeof getChapteredAssetMapping>>;
	try {
		mapping = await getChapteredAssetMapping(assetId);
	} catch (err) {
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "GET",
				additionalData: { assetId },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"Failed to retrieve chaptered asset mapping",
			ErrorCodes.INTERNAL_ERROR,
			requestId,
			500,
		);
	}

	if (!mapping) {
		return createErrorResponse(
			"Chaptered video has not been generated yet. Call POST /api/recording/chapters/{id} to regenerate.",
			ErrorCodes.CHAPTERS_NOT_GENERATED,
			requestId,
			404,
		);
	}

	// 4. Extract chapters from MUX chaptered asset via ffprobe (FR-012)
	try {
		const chapterList = await extractChapters(assetId, mapping.muxPlaybackUrl);
		return createSuccessResponse(chapterList, requestId, 200);
	} catch (err) {
		const stderr = err instanceof RemuxFailedError ? err.stderr : "";
		reportError(
			err instanceof Error ? err : new Error(String(err)),
			{
				requestId,
				route: "/api/recording/chapters",
				method: "GET",
				additionalData: { assetId, stderr },
			},
			ErrorSeverity.ERROR,
		);
		return createErrorResponse(
			"FFmpeg chapter extraction failed",
			ErrorCodes.REMUX_FAILED,
			requestId,
			502,
		);
	}
}
