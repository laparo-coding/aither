// ---------------------------------------------------------------------------
// GET /api/recording/stream/[id] — Serve recording file for streaming
// Task: T032 [US5] — Auth admin/api-client, resolve file via file-manager,
//                     delegate to stream-handler for full/partial response
// Task: T033 [US3] — Check if MUX chaptered asset exists for assetId;
//                     if yes, redirect/proxy to MUX CDN URL; else serve raw.
// ---------------------------------------------------------------------------

import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { reportError } from "@/lib/monitoring/rollbar-official";
import { getChapteredAssetMapping } from "@/lib/recording/chaptered-asset-mapping";
import { resolveFilePath } from "@/lib/recording/file-manager";
import { createStreamResponse } from "@/lib/recording/stream-handler";
import { ErrorCodes, createErrorResponse } from "@/lib/utils/api-response";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ALLOWED_MUX_PLAYBACK_SUBDOMAINS = new Set(["stream"]);

function isAllowedMuxPlaybackUrl(urlString: string): boolean {
	try {
		const parsed = new URL(urlString);
		if (parsed.protocol !== "https:") {
			return false;
		}

		if (parsed.username || parsed.password) {
			return false;
		}

		const hostMatch = parsed.hostname.match(/^([a-z0-9-]+)\.mux\.com$/i);
		if (!hostMatch) {
			return false;
		}

		const subdomain = hostMatch[1].toLowerCase();
		if (!ALLOWED_MUX_PLAYBACK_SUBDOMAINS.has(subdomain)) {
			return false;
		}

		// Only accept MP4 playback URLs (endpoint serves video/mp4 with Range support)
		const pathname = parsed.pathname.toLowerCase();
		return pathname.endsWith(".mp4") || pathname.includes("/direct.mp4");
	} catch {
		return false;
	}
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const authData = await getRouteAuth();
	const authResult = requireAdmin(authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	const { id } = await params;

	// Validate id format (must match rec_YYYY-MM-DDTHH-MM-SSZ)
	const ID_PATTERN = /^rec_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
	if (!id || !ID_PATTERN.test(id)) {
		return createErrorResponse(
			"Invalid recording ID format",
			ErrorCodes.VALIDATION_ERROR,
			undefined,
			400,
		);
	}

	try {
		// Check if MUX chaptered asset exists for this assetId (T033)
		let chapteredMapping: Awaited<ReturnType<typeof getChapteredAssetMapping>>;
		try {
			chapteredMapping = await getChapteredAssetMapping(id);
		} catch (err) {
			reportError(
				err instanceof Error ? err : new Error(String(err)),
				{
					route: "/api/recording/stream",
					method: "GET",
					additionalData: { assetId: id, context: "chaptered_mapping_lookup" },
				},
				"error",
			);
			chapteredMapping = null;
		}

		// If chaptered MUX asset exists, redirect to MUX CDN URL
		if (chapteredMapping) {
			if (!isAllowedMuxPlaybackUrl(chapteredMapping.muxPlaybackUrl)) {
				reportError(
					new Error("Invalid muxPlaybackUrl in chaptered asset mapping"),
					{
						route: "/api/recording/stream",
						method: "GET",
						additionalData: { assetId: id },
					},
					"error",
				);
				return createErrorResponse(
					"Invalid chaptered playback URL configuration",
					ErrorCodes.INTERNAL_ERROR,
					undefined,
					500,
				);
			}
			return Response.redirect(chapteredMapping.muxPlaybackUrl, 302);
		}

		// Fall back to raw MP4 (Spec 004 behavior)
		const filePath = await resolveFilePath(id);
		if (!filePath) {
			return createErrorResponse(`Recording ${id} not found`, ErrorCodes.NOT_FOUND, undefined, 404);
		}

		const rangeHeader = req.headers.get("range");
		const { stream, headers, status } = await createStreamResponse(filePath, rangeHeader);

		return new Response(stream, { status, headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		return createErrorResponse("Internal server error", ErrorCodes.INTERNAL_ERROR, undefined, 500);
	}
}
