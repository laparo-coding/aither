// ---------------------------------------------------------------------------
// AssemblyAI Webhook Route
// Task: T023 [US1] — Authenticated callback handling. Persists the callback
// signal, acknowledges quickly (<10s), and treats duplicate/missed/stale
// callbacks idempotently against the canonical Hemera workflow (FR-028).
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
import { reconcileAssemblyAiCallback } from "@/lib/transcription/callback-reconciler";
import {
	HemeraApiError,
	createHemeraSeminarRecordingClient,
} from "@/lib/transcription/hemera-seminar-client";
import { AssemblyAiCallbackSchema } from "@/lib/transcription/schemas";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/assemblyai/webhook?recordingId=...
 * Auth: X-AssemblyAI-Webhook-Secret header must match the configured secret.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
	const recordingId = request.nextUrl.searchParams.get("recordingId");
	const bookingId = request.nextUrl.searchParams.get("bookingId");
	if (!recordingId || !bookingId) {
		return NextResponse.json({ error: "Missing bookingId or recordingId" }, { status: 400 });
	}

	// Authenticate the callback (FR-028)
	const config = loadConfig();
	const providedSecret = request.headers.get("X-AssemblyAI-Webhook-Secret");
	if (!config.ASSEMBLY_AI_WEBHOOK_SECRET || providedSecret !== config.ASSEMBLY_AI_WEBHOOK_SECRET) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const parsed = AssemblyAiCallbackSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid callback body" }, { status: 400 });
	}

	const hemera = createHemeraSeminarRecordingClient();
	try {
		const result = await reconcileAssemblyAiCallback(hemera, bookingId, recordingId, parsed.data);
		return NextResponse.json({ accepted: true, recordingId, result }, { status: 202 });
	} catch (error) {
		if (error instanceof HemeraApiError && error.status === 404) {
			return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
		}
		console.error(
			"[assemblyai-webhook] Failed to reconcile callback:",
			error instanceof Error ? error.name : "unknown",
		);
		return NextResponse.json({ error: "Workflow reconciliation unavailable" }, { status: 503 });
	}
}

export async function GET(): Promise<NextResponse> {
	return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
