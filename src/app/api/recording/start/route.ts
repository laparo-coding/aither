// ---------------------------------------------------------------------------
// POST /api/recording/start — Start a recording session
// Task: T014 [P] [US1] — Auth requireAdmin, spawn FFmpeg via session-manager,
//                         return 200/409/503
// Task: T019 [US1] — Requires a validated Hemera bookingId; participant
//                         identity is resolved through Hemera and never
//                         trusted from caller input (FR-008).
// ---------------------------------------------------------------------------

import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { reportError } from "@/lib/monitoring/rollbar-official";
import { startRecording } from "@/lib/recording/session-manager";
import { BookingContextSchema } from "@/lib/transcription/schemas";
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "@/lib/utils/api-response";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(request: NextRequest) {
	const authData = await getRouteAuth();
	const authResult = requireAdmin(authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	// Feature 012: a recording must be bound to a validated Hemera booking
	let bookingId: string | undefined;
	try {
		const body = (await request.json()) as { bookingId?: unknown };
		const parsed = BookingContextSchema.pick({ bookingId: true }).safeParse(body);
		if (!parsed.success) {
			return createErrorResponse(
				"A valid Hemera bookingId is required to start a recording",
				ErrorCodes.VALIDATION_ERROR,
				undefined,
				400,
			);
		}
		bookingId = parsed.data.bookingId;
	} catch {
		return createErrorResponse(
			"A valid Hemera bookingId is required to start a recording",
			ErrorCodes.VALIDATION_ERROR,
			undefined,
			400,
		);
	}

	try {
		const session = await startRecording();
		return createSuccessResponse({
			sessionId: session.sessionId,
			status: session.status,
			filename: session.filename,
			startedAt: session.startedAt,
			bookingId,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (message.startsWith("CONFLICT:")) {
			return createErrorResponse(message, ErrorCodes.CONFLICT, undefined, 409);
		}

		if (message.startsWith("FFMPEG_NOT_FOUND:")) {
			reportError(err instanceof Error ? err : new Error(message), undefined, "error");
			return createErrorResponse(message, ErrorCodes.FFMPEG_NOT_FOUND, undefined, 503);
		}

		if (message.startsWith("WEBCAM_UNREACHABLE:")) {
			reportError(err instanceof Error ? err : new Error(message), undefined, "error");
			return createErrorResponse(message, ErrorCodes.WEBCAM_UNREACHABLE, undefined, 503);
		}

		// Unexpected error
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		return createErrorResponse(message, ErrorCodes.INTERNAL_ERROR, undefined, 500);
	}
}
