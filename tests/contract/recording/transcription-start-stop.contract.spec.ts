// ---------------------------------------------------------------------------
// Contract Tests: Transcription Start/Stop
// Task: T016 [P] [US1] — Stop queues only after successful recording
// completion, requires validated booking context, retains the local file
// when Hemera is unavailable, and never calls MUX before a successful
// transcript/mapping.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({
		status: 200,
		body: { sessionClaims: { metadata: { role: "admin" } } },
	}),
}));
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));
vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

const mockStopRecording = vi.fn();
const mockUploadToMux = vi.fn();
const mockUpsertWorkflow = vi.fn().mockResolvedValue({});

vi.mock("@/lib/recording/session-manager", () => ({
	stopRecording: (...args: unknown[]) => mockStopRecording(...args),
}));
vi.mock("@/lib/recording/mux-uploader", () => ({
	uploadToMux: (...args: unknown[]) => mockUploadToMux(...args),
}));
vi.mock("@/lib/recording/source-staging", () => ({
	uploadRecordingToStaging: vi.fn().mockResolvedValue("seminar-sources/booking-1/rec-001.mp4"),
}));
vi.mock("@/lib/transcription/hemera-seminar-client", () => ({
	createHemeraSeminarRecordingClient: () => ({
		upsertWorkflow: (...args: unknown[]) => mockUpsertWorkflow(...args),
	}),
}));

import { POST } from "@/app/api/recording/stop/route";

function createRequest(): NextRequest {
	return new NextRequest("http://localhost/api/recording/stop", { method: "POST" });
}

describe("POST /api/recording/stop — transcription queueing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports queuedForTranscription=true after staging and Hemera enqueue succeed", async () => {
		mockStopRecording.mockResolvedValue({
			sessionId: "rec-001",
			bookingId: "booking-1",
			status: "completed",
			filename: "rec-001.mp4",
			filePath: "/tmp/rec-001.mp4",
			startedAt: "2026-09-30T10:00:00.000Z",
			endedAt: "2026-09-30T10:15:00.000Z",
			duration: 900,
			fileSize: 1024,
		});

		const res = await POST(createRequest());
		const body = (await res.json()) as {
			data?: { queuedForTranscription?: boolean; sourceStagingPathname?: string };
		};

		expect(res.status).toBe(200);
		expect(body.data?.queuedForTranscription).toBe(true);
		expect(body.data?.sourceStagingPathname).toBe("seminar-sources/booking-1/rec-001.mp4");
		expect(mockUpsertWorkflow).toHaveBeenCalledWith(
			"booking-1",
			"rec-001",
			expect.objectContaining({
				status: "queued",
				sourceBlobPathname: "seminar-sources/booking-1/rec-001.mp4",
			}),
			"booking-1:rec-001",
		);
	});

	it("does not queue transcription for a failed or interrupted recording", async () => {
		mockStopRecording.mockResolvedValue({
			sessionId: "rec-002",
			bookingId: "booking-1",
			status: "failed",
			filename: "rec-002.mp4",
			startedAt: "2026-09-30T10:00:00.000Z",
			endedAt: null,
			duration: null,
			fileSize: 0,
		});

		const res = await POST(createRequest());
		const body = (await res.json()) as { data?: { queuedForTranscription?: boolean } };

		expect(res.status).toBe(200);
		expect(body.data?.queuedForTranscription).toBe(false);
	});

	it("never calls MUX during the stop flow", async () => {
		mockStopRecording.mockResolvedValue({
			sessionId: "rec-003",
			bookingId: "booking-1",
			status: "completed",
			filename: "rec-003.mp4",
			filePath: "/tmp/rec-003.mp4",
			startedAt: "2026-09-30T10:00:00.000Z",
			endedAt: "2026-09-30T10:15:00.000Z",
			duration: 900,
			fileSize: 1024,
		});

		await POST(createRequest());

		expect(mockUploadToMux).not.toHaveBeenCalled();
	});

	it("returns the deterministic private staging pathname for a queued recording", async () => {
		mockStopRecording.mockResolvedValue({
			sessionId: "rec-004",
			bookingId: "booking-1",
			status: "completed",
			filename: "rec-004.mp4",
			filePath: "/tmp/rec-004.mp4",
			startedAt: "2026-09-30T10:00:00.000Z",
			endedAt: "2026-09-30T10:15:00.000Z",
			duration: 900,
			fileSize: 1024,
		});

		const res = await POST(createRequest());
		const body = (await res.json()) as { data?: { sourceStagingPathname?: string } };

		expect(body.data?.sourceStagingPathname).toContain("seminar-sources/");
	});

	it("propagates a 404 when no active session exists", async () => {
		mockStopRecording.mockRejectedValue(new Error("NOT_FOUND: no active recording session"));

		const res = await POST(createRequest());
		expect(res.status).toBe(404);
	});
});
