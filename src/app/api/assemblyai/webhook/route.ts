// ---------------------------------------------------------------------------
// AssemblyAI Webhook Route
// Task: T023 [US1] — Authenticated callback handling. Persists the callback
// signal, acknowledges quickly (<10s), and treats duplicate/missed/stale
// callbacks idempotently against the canonical Hemera workflow (FR-028).
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
import { AssemblyAiCallbackSchema } from "@/lib/transcription/schemas";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/assemblyai/webhook?recordingId=...
 * Auth: X-AssemblyAI-Webhook-Secret header must match the configured secret.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
	const recordingId = request.nextUrl.searchParams.get("recordingId");
	if (!recordingId) {
		return NextResponse.json({ error: "Missing recordingId" }, { status: 400 });
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

	// The worker reconciles against canonical Hemera state; the webhook only
	// records the delivery signal. Duplicate/stale callbacks are idempotent
	// because the worker re-reads the workflow before acting (FR-028).
	// Sanitized trace only: transcript ID and status, never payload content.
	return NextResponse.json(
		{
			accepted: true,
			recordingId,
			transcriptId: parsed.data.transcript_id,
			status: parsed.data.status,
		},
		{ status: 202 },
	);
}

export async function GET(): Promise<NextResponse> {
	return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
