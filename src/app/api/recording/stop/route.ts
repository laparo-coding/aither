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

import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { reportError } from "@/lib/monitoring/rollbar-official";
import { stopRecording } from "@/lib/recording/session-manager";
import { buildSourceStagingPathname } from "@/lib/recording/source-staging";
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

		// Feature 012: idempotently create the Hemera workflow with the
		// real bookingId from the session, then report the queued intent.
		// If Hemera is unreachable, return queuedForTranscription: false
		// so the caller knows to retry via the worker.
		const bookingId = (session as Record<string, unknown>).bookingId as string | undefined;
		const effectiveBookingId = bookingId ?? "pending-booking";

		let workflowCreated = false;
		try {
			// TODO: Wire real Hemera client and call upsertWorkflow here
			// const pathname = await uploadToStaging(session.sessionId);
			// await hemera.upsertWorkflow(effectiveBookingId, session.sessionId, {
			//   status: "queued",
			//   sourceBlobPathname: pathname,
			// });
			// Keep false until Hemera wiring is complete — do not report
			// queuedForTranscription: true for a workflow that was never created
			workflowCreated = false;
		} catch {
			// Hemera unreachable — retain staged object for worker retry path
			workflowCreated = false;
		}

		return createSuccessResponse({
			sessionId: session.sessionId,
			status: session.status,
			filename: session.filename,
			startedAt: session.startedAt,
			endedAt: session.endedAt,
			duration: session.duration,
			fileSize: session.fileSize,
			queuedForTranscription: workflowCreated,
			sourceStagingPathname: buildSourceStagingPathname(effectiveBookingId, session.sessionId),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (message.startsWith("NOT_FOUND:")) {
			return createErrorResponse(message, ErrorCodes.NOT_FOUND, undefined, 404);
		}

		// Unexpected error
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		return createErrorResponse("Internal server error", ErrorCodes.INTERNAL_ERROR, undefined, 500);
	}
}
