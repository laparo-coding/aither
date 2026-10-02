// ---------------------------------------------------------------------------
// Transcription Review Route (Aither Admin)
// Task: T025 [US1] — Authorizes an Aither admin, validates distinct speaker
// IDs, persists the approved mapping/reviewer/timestamp to Hemera, and
// resumes publication only after explicit approval (FR-014). The approved
// mapping is authoritative; later callbacks cannot overwrite it.
// ---------------------------------------------------------------------------

import { getRouteAuth } from "@/lib/auth/route-auth";
import { loadConfig } from "@/lib/config";
import {
	AssemblyAiAdapter,
	type AssemblyAiTranscript,
} from "@/lib/transcription/assemblyai-client";
import { createHemeraSeminarRecordingClient } from "@/lib/transcription/hemera-seminar-client";
import { validateOperatorMapping } from "@/lib/transcription/role-mapping";
import { OperatorReviewSchema } from "@/lib/transcription/schemas";
import type { SeminarRecordingWorkflow } from "@/lib/transcription/types";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/recording/transcription/[id]/review
 * Body: { bookingId, participantSpeakerId, leaderSpeakerId, approve: true }
 */
export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
	const { id: recordingId } = await params;

	// Restrict review to authorized operators (FR-014)
	const auth = (await getRouteAuth()) as {
		userId?: string;
		sessionClaims?: { metadata?: { role?: string; userId?: string } };
	} | null;
	if (!auth?.sessionClaims?.metadata || auth.sessionClaims.metadata.role !== "admin") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const parsed = OperatorReviewSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid review payload" }, { status: 422 });
	}

	const { bookingId, participantSpeakerId, leaderSpeakerId } = parsed.data;

	// Reject same-ID mappings (FR-004)
	if (participantSpeakerId === leaderSpeakerId) {
		return NextResponse.json(
			{ error: "Both roles must map to distinct speaker IDs" },
			{ status: 422 },
		);
	}

	// Load the current workflow from Hemera and verify it is awaiting review
	const hemera = createHemeraSeminarRecordingClient();
	let workflow: SeminarRecordingWorkflow;
	try {
		workflow = await hemera.getWorkflow(bookingId, recordingId);
	} catch (err) {
		const status = (err as { status?: number }).status ?? 0;
		if (status === 404) {
			return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
		}
		console.error("[review] Hemera getWorkflow error:", err);
		return NextResponse.json(
			{ error: "Hemera unavailable" },
			{ status: status >= 500 ? 503 : 502 },
		);
	}

	if (workflow.status !== "review_required") {
		return NextResponse.json(
			{ error: `Workflow is not reviewable (current status: ${workflow.status})` },
			{ status: 409 },
		);
	}
	if (workflow.bookingId !== bookingId || !workflow.assemblyAiTranscriptId) {
		return NextResponse.json({ error: "Workflow transcript is unavailable" }, { status: 409 });
	}

	let transcript: AssemblyAiTranscript;
	try {
		const config = loadConfig();
		if (
			!config.ASSEMBLY_AI_BASE_URL ||
			!config.ASSEMBLY_AI_API_KEY ||
			!config.ASSEMBLY_AI_WEBHOOK_SECRET ||
			!config.AITHER_PUBLIC_BASE_URL
		) {
			throw new Error("AssemblyAI review configuration is incomplete");
		}
		const webhookUrl = new URL("/api/assemblyai/webhook", config.AITHER_PUBLIC_BASE_URL);
		webhookUrl.searchParams.set("recordingId", recordingId);
		const assemblyai = new AssemblyAiAdapter({
			baseUrl: config.ASSEMBLY_AI_BASE_URL,
			apiKey: config.ASSEMBLY_AI_API_KEY,
			webhookUrl: webhookUrl.toString(),
			webhookSecret: config.ASSEMBLY_AI_WEBHOOK_SECRET,
		});
		transcript = await assemblyai.getTranscript(workflow.assemblyAiTranscriptId);
	} catch (err) {
		console.error(
			"[review] Failed to fetch provider transcript:",
			err instanceof Error ? err.name : "unknown",
		);
		return NextResponse.json({ error: "Transcript unavailable" }, { status: 502 });
	}
	if (transcript.status !== "completed" || !transcript.utterances) {
		return NextResponse.json({ error: "Transcript is not complete" }, { status: 409 });
	}

	const validation = validateOperatorMapping(
		leaderSpeakerId,
		participantSpeakerId,
		transcript.utterances.map((utterance) => ({
			speakerId: utterance.speaker || null,
			text: utterance.text,
			startMs: utterance.start,
			endMs: utterance.end,
		})),
	);
	if (!validation.valid) {
		return NextResponse.json({ error: validation.reason }, { status: 422 });
	}

	// Persist the approved mapping to Hemera as the authoritative record
	const reviewedAt = new Date().toISOString();
	const operatorId = String(auth.sessionClaims.metadata.userId ?? auth.userId ?? "unknown-admin");
	const idempotencyKey = `${bookingId}:${recordingId}:review`;

	try {
		await hemera.upsertWorkflow(
			bookingId,
			recordingId,
			{
				status: "publishing",
				recordingDate: workflow.recordingDate,
				reviewedSpeakerMapping: {
					[leaderSpeakerId]: "Seminarleiter",
					[participantSpeakerId]: "Teilnehmerin",
				},
				reviewedBy: operatorId,
				reviewedAt,
			},
			idempotencyKey,
		);
	} catch (err) {
		console.error("[review] Failed to persist approval:", err);
		return NextResponse.json({ error: "Failed to persist review" }, { status: 502 });
	}

	return NextResponse.json(
		{
			accepted: true,
			recordingId,
			bookingId,
			reviewedSpeakerMapping: {
				[leaderSpeakerId]: "Seminarleiter",
				[participantSpeakerId]: "Teilnehmerin",
			},
			reviewedBy: operatorId,
			reviewedAt,
		},
		{ status: 200 },
	);
}
