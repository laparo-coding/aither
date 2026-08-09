// ---------------------------------------------------------------------------
// POST /api/recording/playback/play — Start playback
// Task: T024 [P] [US3] — Auth admin/api-client, dispatch `play` via
//                         playback-controller, return state
// Task: T027 [US2] — Accept optional chapterId, seek to chapter start,
//                     validate chapterId in range (404 CHAPTER_NOT_FOUND),
//                     return ChapterPlaybackResult with start/end.
// ---------------------------------------------------------------------------

import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { reportError } from "@/lib/monitoring/rollbar-official";
import { extractChapters } from "@/lib/recording/chapter-extractor";
import { getChapteredAssetMapping } from "@/lib/recording/chaptered-asset-mapping";
import { dispatchCommand } from "@/lib/recording/playback-controller";
import { ChapterPlaybackRequestSchema } from "@/lib/recording/schemas";
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "@/lib/utils/api-response";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(req: NextRequest) {
	const authData = await getRouteAuth();
	const authResult = requireAdmin(authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	try {
		const body = await req.json();
		const parsed = ChapterPlaybackRequestSchema.safeParse(body);
		if (!parsed.success) {
			return createErrorResponse(
				"Invalid request body",
				ErrorCodes.VALIDATION_ERROR,
				undefined,
				400,
				{ issues: parsed.error.issues },
			);
		}

		const { recordingId, chapterId, startAtFirst } = parsed.data;

		// If no chapterId, check startAtFirst for server-side initial seek (Spec 011, FR-005).
		// When startAtFirst is omitted/false, dispatch plain play (Spec 004 backward compatible).
		if (chapterId === undefined) {
			if (startAtFirst === true) {
				// Attempt to seek to chapters[0].start before playing (FR-005).
				// Falls back to plain play if no chaptered asset exists or extraction fails.
				try {
					const mapping = await getChapteredAssetMapping(recordingId);
					if (mapping) {
						const chapterList = await extractChapters(recordingId, mapping.muxPlaybackUrl);
						if (chapterList.chapters.length > 0) {
							const firstChapter = chapterList.chapters[0];
							const seekResult = dispatchCommand(recordingId, {
								action: "seek",
								position: firstChapter.start,
							});
							if (!seekResult) {
								return createErrorResponse(
									"No player connected for this recording",
									ErrorCodes.NOT_FOUND,
									undefined,
									404,
								);
							}
							const playResult = dispatchCommand(recordingId, { action: "play" });
							if (!playResult) {
								return createErrorResponse(
									"No player connected for this recording",
									ErrorCodes.NOT_FOUND,
									undefined,
									404,
								);
							}
							return createSuccessResponse({
								accepted: true,
								chapterId: 0,
								start: firstChapter.start,
								end: firstChapter.end,
							});
						}
					}
					// No mapping or no chapters — fall through to plain play.
				} catch (err) {
					// Log but don't fail — fall through to plain play (backward compatible).
					reportError(
						err instanceof Error ? err : new Error(String(err)),
						{
							route: "/api/recording/playback/play",
							method: "POST",
							additionalData: { recordingId, startAtFirst: true },
						},
						"warning",
					);
				}
			}

			// Plain play (Spec 004 backward compatible — resume from current position)
			const result = dispatchCommand(recordingId, { action: "play" });
			if (!result) {
				return createErrorResponse(
					"No player connected for this recording",
					ErrorCodes.NOT_FOUND,
					undefined,
					404,
				);
			}
			return createSuccessResponse({ accepted: true, ...result });
		}

		// chapterId provided — fetch chapter list from MUX chaptered asset (T027)
		let mapping: Awaited<ReturnType<typeof getChapteredAssetMapping>>;
		try {
			mapping = await getChapteredAssetMapping(recordingId);
		} catch (err) {
			reportError(
				err instanceof Error ? err : new Error(String(err)),
				{ route: "/api/recording/playback/play", method: "POST", additionalData: { recordingId } },
				"error",
			);
			return createErrorResponse(
				"Failed to retrieve chaptered asset mapping",
				ErrorCodes.INTERNAL_ERROR,
				undefined,
				500,
			);
		}

		if (!mapping) {
			return createErrorResponse(
				"Chaptered video has not been generated yet",
				ErrorCodes.CHAPTERS_NOT_GENERATED,
				undefined,
				404,
			);
		}

		let chapterList: Awaited<ReturnType<typeof extractChapters>>;
		try {
			chapterList = await extractChapters(recordingId, mapping.muxPlaybackUrl);
		} catch (err) {
			reportError(
				err instanceof Error ? err : new Error(String(err)),
				{ route: "/api/recording/playback/play", method: "POST", additionalData: { recordingId } },
				"error",
			);
			return createErrorResponse(
				"FFmpeg chapter extraction failed",
				ErrorCodes.CHAPTER_EXTRACTION_FAILED,
				undefined,
				502,
			);
		}

		// Validate chapterId in range (404 CHAPTER_NOT_FOUND, FR-016)
		const chapter = chapterList.chapters.find((c) => c.id === chapterId);
		if (!chapter) {
			return createErrorResponse(
				"Chapter ID does not exist for this recording",
				ErrorCodes.CHAPTER_NOT_FOUND,
				undefined,
				404,
			);
		}

		// Seek to chapter start, then play (FR-015)
		const seekResult = dispatchCommand(recordingId, { action: "seek", position: chapter.start });
		if (!seekResult) {
			return createErrorResponse(
				"No player connected for this recording",
				ErrorCodes.NOT_FOUND,
				undefined,
				404,
			);
		}
		const playResult = dispatchCommand(recordingId, { action: "play" });
		if (!playResult) {
			return createErrorResponse(
				"No player connected for this recording",
				ErrorCodes.NOT_FOUND,
				undefined,
				404,
			);
		}

		// Return ChapterPlaybackResult with start/end (FR-015)
		return createSuccessResponse({
			accepted: true,
			chapterId,
			start: chapter.start,
			end: chapter.end,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		return createErrorResponse("Internal server error", ErrorCodes.INTERNAL_ERROR, undefined, 500);
	}
}
