// ---------------------------------------------------------------------------
// Service-Only Media Access Endpoint
// Task: T032 [US2] — Called only by Hemera server-side after booking-ownership
// verification. Requires service auth, verifies booking/recording match and
// `ready` status, mints a MUX JWT valid through the video duration and a
// five-minute Blob URL, and excludes URLs/tokens from logs (FR-012).
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
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
	const config = loadConfig();

	// Service authentication — Hemera only
	const serviceKey = request.headers.get("X-Aither-Service-Key");
	if (!config.AITHER_SERVICE_KEY || serviceKey !== config.AITHER_SERVICE_KEY) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

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

	// NOTE: Full wiring happens in T031/T032; the route must validate Hemera
	// service auth, verify booking/recording match and `ready` status, mint a MUX
	// JWT valid through video duration and a five-minute Blob URL, and exclude
	// URLs/tokens from logs. Until fully implemented, return 501.
	const { bookingId, recordingId } = parsed.data;

	return NextResponse.json(
		{
			error: "Not implemented — service document access endpoint pending T032 wiring",
			bookingId,
			recordingId,
		},
		{ status: 501 },
	);
}
