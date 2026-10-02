// ---------------------------------------------------------------------------
// Service-Only Media Access Endpoint
// Task: T032 [US2] — Called only by Hemera server-side after booking-ownership
// verification. Requires service auth, verifies booking/recording match and
// `ready` status, mints a MUX JWT valid through the video duration and a
// five-minute Blob URL, and excludes URLs/tokens from logs (FR-012).
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
import { computeMuxTokenTtlSeconds } from "@/lib/recording/mux-uploader-signed";
import { buildStablePlaybackReference } from "@/lib/recording/mux-uploader-signed";
import { buildTranscriptPathname, createPrivateBlobReadUrl } from "@/lib/recording/source-staging";
import {
	HemeraApiError,
	createHemeraSeminarRecordingClient,
} from "@/lib/transcription/hemera-seminar-client";
import Mux from "@mux/mux-node";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AccessRequestSchema = z.object({
	bookingId: z.string().min(1),
	recordingId: z.string().min(1),
});

/**
 * POST /api/service/seminar-document-access
 * Auth: X-Aither-Service-Key header (Hemera service credential).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const parsed = AccessRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}

	let config: ReturnType<typeof loadConfig>;
	try {
		config = loadConfig();
	} catch (error) {
		console.error(
			"[seminar-document-access] Configuration unavailable:",
			error instanceof Error ? error.name : "unknown",
		);
		return NextResponse.json({ error: "Media access unavailable" }, { status: 503 });
	}

	const serviceKey = request.headers.get("X-Aither-Service-Key");
	if (!config.AITHER_SERVICE_KEY || serviceKey !== config.AITHER_SERVICE_KEY) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (
		!config.MUX_SIGNING_KEY_ID ||
		!config.MUX_SIGNING_KEY_PRIVATE_KEY ||
		!config.BLOB_READ_WRITE_TOKEN
	) {
		return NextResponse.json({ error: "Media access is not configured" }, { status: 503 });
	}

	const { bookingId, recordingId } = parsed.data;
	const hemera = createHemeraSeminarRecordingClient();
	let booking: Awaited<ReturnType<typeof hemera.getBookingContext>>;
	let workflow: Awaited<ReturnType<typeof hemera.getWorkflow>>;
	try {
		[booking, workflow] = await Promise.all([
			hemera.getBookingContext(bookingId),
			hemera.getWorkflow(bookingId, recordingId),
		]);
	} catch (error) {
		if (error instanceof HemeraApiError && error.status === 404) {
			return NextResponse.json({ error: "Booking or recording not found" }, { status: 404 });
		}
		console.error(
			"[seminar-document-access] Hemera request failed:",
			error instanceof Error ? error.name : "unknown",
		);
		return NextResponse.json({ error: "Workflow unavailable" }, { status: 503 });
	}

	if (
		workflow.bookingId !== bookingId ||
		workflow.recordingId !== recordingId ||
		workflow.participantUserId !== booking.participantUserId
	) {
		return NextResponse.json({ error: "Booking and recording do not match" }, { status: 409 });
	}
	if (
		workflow.status !== "ready" ||
		!workflow.muxPlaybackId ||
		!workflow.muxPlaybackUrl ||
		!workflow.durationSeconds ||
		workflow.durationSeconds <= 0 ||
		workflow.transcriptBlobPathname !== buildTranscriptPathname(bookingId, recordingId) ||
		workflow.muxPlaybackUrl !== buildStablePlaybackReference(workflow.muxPlaybackId)
	) {
		return NextResponse.json({ error: "Workflow is not ready for media access" }, { status: 409 });
	}

	const issuedAt = Date.now();
	const muxTtlSeconds = computeMuxTokenTtlSeconds(workflow.durationSeconds);
	const muxExpiresAt = new Date(issuedAt + muxTtlSeconds * 1000);
	const transcriptExpiresAt = new Date(issuedAt + 5 * 60 * 1000);
	try {
		const mux = new Mux({
			jwtSigningKey: config.MUX_SIGNING_KEY_ID,
			jwtPrivateKey: config.MUX_SIGNING_KEY_PRIVATE_KEY.replace(/\\n/g, "\n"),
		});
		const token = await mux.jwt.signPlaybackId(workflow.muxPlaybackId, {
			type: "video",
			expiration: `${muxTtlSeconds}s`,
		});
		const muxPlaybackUrl = new URL(buildStablePlaybackReference(workflow.muxPlaybackId));
		muxPlaybackUrl.searchParams.set("token", token);
		const transcriptUrl = await createPrivateBlobReadUrl(
			workflow.transcriptBlobPathname,
			transcriptExpiresAt.getTime(),
		);

		return NextResponse.json({
			muxPlaybackUrl: muxPlaybackUrl.toString(),
			transcriptUrl,
			muxExpiresAt: muxExpiresAt.toISOString(),
			transcriptExpiresAt: transcriptExpiresAt.toISOString(),
		});
	} catch (error) {
		console.error(
			"[seminar-document-access] Failed to mint media URLs:",
			error instanceof Error ? error.name : "unknown",
		);
		return NextResponse.json({ error: "Media access unavailable" }, { status: 502 });
	}
}
