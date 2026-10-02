import { POST } from "@/app/api/service/seminar-document-access/route";
import { SeminarRecordingWorkflowSchema } from "@/lib/transcription/schemas";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadConfig: vi.fn(),
	getBookingContext: vi.fn(),
	getWorkflow: vi.fn(),
	createPrivateBlobReadUrl: vi.fn(),
	signPlaybackId: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("@/lib/transcription/hemera-seminar-client", () => ({
	HemeraApiError: class HemeraApiError extends Error {
		constructor(public readonly status: number) {
			super(`Hemera API error ${status}`);
		}
	},
	createHemeraSeminarRecordingClient: () => ({
		getBookingContext: mocks.getBookingContext,
		getWorkflow: mocks.getWorkflow,
	}),
}));
vi.mock("@/lib/recording/source-staging", () => ({
	buildTranscriptPathname: (bookingId: string, recordingId: string) =>
		`seminar-transcripts/${bookingId}/${recordingId}.txt`,
	createPrivateBlobReadUrl: mocks.createPrivateBlobReadUrl,
}));
vi.mock("@mux/mux-node", () => ({
	default: class MockMux {
		jwt = { signPlaybackId: mocks.signPlaybackId };
	},
}));

function createRequest(serviceKey = "service-key") {
	return new NextRequest("https://aither.example/api/service/seminar-document-access", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Aither-Service-Key": serviceKey,
		},
		body: JSON.stringify({ bookingId: "booking-1", recordingId: "recording-1" }),
	});
}

function createReadyWorkflow() {
	return SeminarRecordingWorkflowSchema.parse({
		bookingId: "booking-1",
		participantUserId: "participant-1",
		recordingId: "recording-1",
		recordingDate: "2026-09-30T10:30:00.000Z",
		status: "ready",
		muxAssetId: "asset-1",
		muxPlaybackId: "playback-1",
		muxPlaybackUrl: "https://stream.mux.com/playback-1.m3u8",
		durationSeconds: 1140,
		transcriptBlobPathname: "seminar-transcripts/booking-1/recording-1.txt",
	});
}

describe("seminar document access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadConfig.mockReturnValue({
			AITHER_SERVICE_KEY: "service-key",
			MUX_SIGNING_KEY_ID: "mux-key-id",
			MUX_SIGNING_KEY_PRIVATE_KEY: "private-key",
			BLOB_READ_WRITE_TOKEN: "blob-token",
		});
		mocks.getBookingContext.mockResolvedValue({
			bookingId: "booking-1",
			participantUserId: "participant-1",
			courseId: "course-1",
		});
		mocks.getWorkflow.mockResolvedValue(createReadyWorkflow());
		mocks.createPrivateBlobReadUrl.mockResolvedValue("https://blob.example/transcript?sig=private");
		mocks.signPlaybackId.mockResolvedValue("video.jwt");
	});

	it("issues duration-aware MUX and five-minute private transcript URLs", async () => {
		const response = await POST(createRequest());
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(mocks.signPlaybackId).toHaveBeenCalledWith("playback-1", {
			type: "video",
			expiration: "1200s",
		});
		expect(payload.muxPlaybackUrl).toBe("https://stream.mux.com/playback-1.m3u8?token=video.jwt");
		expect(payload.transcriptUrl).toBe("https://blob.example/transcript?sig=private");
		const expiry = Date.parse(payload.transcriptExpiresAt);
		expect(expiry - Date.now()).toBeGreaterThan(4 * 60 * 1000);
		expect(expiry - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
		expect(mocks.createPrivateBlobReadUrl).toHaveBeenCalledWith(
			"seminar-transcripts/booking-1/recording-1.txt",
			expiry,
		);
	});

	it("rejects access when the workflow is not ready", async () => {
		mocks.getWorkflow.mockResolvedValue({
			...createReadyWorkflow(),
			status: "publishing",
		});

		const response = await POST(createRequest());

		expect(response.status).toBe(409);
		expect(mocks.signPlaybackId).not.toHaveBeenCalled();
		expect(mocks.createPrivateBlobReadUrl).not.toHaveBeenCalled();
	});

	it("keeps service-key authentication in the handler", async () => {
		const response = await POST(createRequest("invalid"));

		expect(response.status).toBe(401);
		expect(mocks.getWorkflow).not.toHaveBeenCalled();
	});
});
