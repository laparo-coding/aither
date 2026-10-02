// ---------------------------------------------------------------------------
// POST /api/recording/stop — Stop the active recording session
// Task: T015 [P] [US1] — Auth requireAdmin, graceful SIGINT via
//                         session-manager, return file details 200/404
// Task: T020 [US1] — On successful stop: idempotently create the Hemera
//                         workflow, upload the MP4 to private Blob staging,
//                         delete the local MP4 after staging confirmation,
//                         and return a queued result. If Hemera is
//                         unreachable, retain only the staged object for an
//                         explicit enqueue/retry path (FR-001/FR-019/FR-021).
// ---------------------------------------------------------------------------

import { unlink } from "node:fs/promises";
import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { reportError } from "@/lib/monitoring/rollbar-official";
import { stopRecording } from "@/lib/recording/session-manager";
import { uploadRecordingToStaging } from "@/lib/recording/source-staging";
import { createHemeraSeminarRecordingClient } from "@/lib/transcription/hemera-seminar-client";
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "@/lib/utils/api-response";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
	const authData = await getRouteAuth();
	const authResult = requireAdmin(authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	try {
		const session = await stopRecording();

		// Only a confirmed-successful stop enters the transcription workflow
		// (FR-001); failed/interrupted recordings never create a workflow.
		if (session.status !== "completed") {
			return createSuccessResponse({
				sessionId: session.sessionId,
				status: session.status,
				filename: session.filename,
				startedAt: session.startedAt,
				endedAt: session.endedAt,
				duration: session.duration,
				fileSize: session.fileSize,
				queuedForTranscription: false,
			});
		}

		const bookingId = session.bookingId;
		const pathname = await uploadRecordingToStaging(bookingId, session.sessionId, session.filePath);
		try {
			const hemera = createHemeraSeminarRecordingClient();
			await hemera.upsertWorkflow(
				bookingId,
				session.sessionId,
				{
					status: "queued",
					recordingDate: session.startedAt,
					queuedAt: new Date().toISOString(),
					firstProviderAttemptAt: null,
					sourceBlobPathname: pathname,
					stageAttemptCounts: {},
				},
				`${bookingId}:${session.sessionId}`,
			);
		} catch (err) {
			reportError(err instanceof Error ? err : new Error(String(err)), undefined, "error");
			return createErrorResponse(
				"Recording is staged but could not be added to the transcription queue; retry stopping to enqueue it",
				ErrorCodes.EXTERNAL_SERVICE_ERROR,
				undefined,
				503,
			);
		}

		try {
			await unlink(session.filePath);
		} catch (err) {
			if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
				reportError(err instanceof Error ? err : new Error(String(err)), undefined, "warning");
			}
		}

		return createSuccessResponse({
			sessionId: session.sessionId,
			status: session.status,
			filename: session.filename,
			startedAt: session.startedAt,
			endedAt: session.endedAt,
			duration: session.duration,
			fileSize: session.fileSize,
			queuedForTranscription: true,
			sourceStagingPathname: pathname,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (message.startsWith("NOT_FOUND:")) {
			return createErrorResponse(message, ErrorCodes.NOT_FOUND, undefined, 404);
		}
		if (message.startsWith("BLOB_STORAGE_UNAVAILABLE:")) {
			reportError(err instanceof Error ? err : new Error(message), undefined, "error");
			return createErrorResponse(message, ErrorCodes.EXTERNAL_SERVICE_ERROR, undefined, 503);
		}

		// Unexpected error
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		return createErrorResponse("Internal server error", ErrorCodes.INTERNAL_ERROR, undefined, 500);
	}
}
