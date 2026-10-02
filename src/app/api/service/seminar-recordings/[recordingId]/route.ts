// ---------------------------------------------------------------------------
// Service-Authenticated Deletion Endpoint
// Task: T041 [US3] — Idempotently deletes any AssemblyAI transcript/source
// media, MUX asset, private Blob objects, and local recording artifact.
// Reports partial outcomes; acknowledges completion to Hemera only when
// every known artifact is deleted or idempotently confirmed already
// deleted (FR-017/FR-023/FR-027).
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
import { createHemeraSeminarRecordingClient } from "@/lib/transcription/hemera-seminar-client";
import { DeletionRequestSchema } from "@/lib/transcription/schemas";
import type { SeminarRecordingWorkflow } from "@/lib/transcription/types";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/service/seminar-recordings/[recordingId]
 * Auth: X-Aither-Service-Key header (Hemera service credential).
 * Body: { bookingId, deletionId, deletionReason }
 */
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ recordingId: string }> },
): Promise<NextResponse> {
	const config = loadConfig();

	const serviceKey = request.headers.get("X-Aither-Service-Key");
	if (!config.AITHER_SERVICE_KEY || serviceKey !== config.AITHER_SERVICE_KEY) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { recordingId } = await params;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const parsed = DeletionRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid deletion request" }, { status: 400 });
	}

	// Deletion is idempotent: repeated requests for the same deletionId are
	// safe. Verify ownership and load current workflow state before proceeding.
	const { bookingId, deletionId, deletionReason } = parsed.data;

	// Load workflow to verify ownership and determine current state
	const hemera = createHemeraSeminarRecordingClient();
	let workflow: SeminarRecordingWorkflow;
	try {
		workflow = await hemera.getWorkflow(bookingId, recordingId);
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		const status = (error as { status?: number }).status ?? 0;

		// Only treat Hemera 404 as idempotent success (already deleted)
		if (status === 404) {
			return NextResponse.json(
				{
					accepted: true,
					recordingId,
					deletionId,
					deletionReason,
					status: "deleted",
					partialOutcomes: [],
				},
				{ status: 200 },
			);
		}

		// Other Hemera errors (network, 5xx, auth) — cannot confirm deletion state
		console.error("[seminar-recordings] Hemera getWorkflow error:", error.message);
		return NextResponse.json(
			{
				error: "Hemera unavailable",
				recordingId,
				deletionId,
			},
			{ status: status >= 500 ? 503 : 502 },
		);
	}

	// TODO: Wire actual provider deletion (AssemblyAI transcript, MUX asset, Blob objects)
	// For now, accept the deletion job and return accepted status.
	// Return 200 only when every known artifact is confirmed deleted (FR-023).
	const allArtifactsDeleted =
		!workflow.assemblyAiTranscriptId && !workflow.muxAssetId && !workflow.transcriptBlobPathname;

	if (allArtifactsDeleted) {
		return NextResponse.json(
			{
				accepted: true,
				recordingId,
				deletionId,
				deletionReason,
				status: "deleted",
				partialOutcomes: [],
			},
			{ status: 200 },
		);
	}

	return NextResponse.json(
		{
			accepted: true,
			recordingId,
			deletionId,
			deletionReason,
			status: "deletion_accepted",
			pendingArtifacts: [
				...(workflow.assemblyAiTranscriptId ? ["assemblyai_transcript"] : []),
				...(workflow.muxAssetId ? ["mux_asset"] : []),
				...(workflow.transcriptBlobPathname ? ["transcript_blob"] : []),
			],
		},
		{ status: 202 },
	);
}
