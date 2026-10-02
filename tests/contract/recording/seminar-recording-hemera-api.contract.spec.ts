// ---------------------------------------------------------------------------
// Contract Tests: Aither → Hemera Seminar Recording Service API
// Task: T001 [P] — Failing contract tests for booking lookup, idempotent
// workflow create/update, queued-job listing, deletion acknowledgment, and
// service authentication/status codes per
// specs/012-video-transcription/contracts/seminar-recording-api.openapi.yaml
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

import { HemeraSeminarRecordingClient } from "@/lib/transcription/hemera-seminar-client";
import {
	BookingContextSchema,
	SeminarRecordingWorkflowSchema,
	WorkflowStatusSchema,
	WorkflowUpdateSchema,
} from "@/lib/transcription/schemas";

// --- Test fixtures ---------------------------------------------------------

const BOOKING_ID = "booking-001";
const RECORDING_ID = "rec_2026-09-30T10-00-00Z";
const IDEMPOTENCY_HEADER = `${BOOKING_ID}:${RECORDING_ID}`;
const TEST_AUTH_HEADER_VALUE = `srv_${process.pid.toString(36)}`;

const BOOKING_CONTEXT = {
	bookingId: BOOKING_ID,
	participantUserId: "user-participant-001",
	courseId: "course-001",
};

const WORKFLOW_RECORD = {
	bookingId: BOOKING_ID,
	participantUserId: "user-participant-001",
	recordingId: RECORDING_ID,
	status: "queued",
	recordingDate: "2026-09-30T10:15:00.000Z",
	queuedAt: "2026-09-30T10:15:01.000Z",
	firstProviderAttemptAt: null,
	assemblyAiTranscriptId: null,
	assemblyAiStatus: null,
	sourceBlobPathname: "seminar-sources/booking-001/rec_2026-09-30T10-00-00Z.mp4",
	muxAssetId: null,
	muxPlaybackId: null,
	muxPlaybackUrl: null,
	transcriptBlobPathname: null,
	lastErrorCode: null,
	stageAttemptCounts: {},
	assemblyAiCleanupStatus: "not_required",
	sourceBlobCleanupStatus: "not_required",
	reviewedSpeakerMapping: null,
	reviewedBy: null,
	reviewedAt: null,
	deletionRequestedAt: null,
	deletionConfirmedAt: null,
	traceEvents: [],
};

function createMockFetch(
	responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	let index = 0;
	const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		const response = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return new Response(JSON.stringify(response.body ?? {}), {
			status: response.status,
			headers: response.headers ?? { "Content-Type": "application/json" },
		});
	});
	return { fetchFn, calls };
}

// --- Tests ----------------------------------------------------------------

describe("Hemera seminar recording service API contract", () => {
	let client: HemeraSeminarRecordingClient;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("booking lookup (GET /api/service/bookings/{bookingId})", () => {
		it("sends the X-API-Key header and validates the BookingContext response", async () => {
			const { fetchFn, calls } = createMockFetch([{ status: 200, body: BOOKING_CONTEXT }]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			const result = await client.getBookingContext(BOOKING_ID);

			expect(calls[0].url).toBe(`https://hemera.test.local/api/service/bookings/${BOOKING_ID}`);
			expect((calls[0].init?.headers as Record<string, string>)["X-API-Key"]).toBe(
				TEST_AUTH_HEADER_VALUE,
			);
			expect(result).toEqual(BOOKING_CONTEXT);
			expect(() => BookingContextSchema.parse(result)).not.toThrow();
		});

		it("throws a HemeraApiError on 404 and does not return participant data", async () => {
			const { fetchFn } = createMockFetch([{ status: 404, body: { error: "not found" } }]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			await expect(client.getBookingContext("missing-booking")).rejects.toThrow(
				/Hemera API error 404/,
			);
		});

		it("throws on 401 when the service credential is invalid", async () => {
			const { fetchFn } = createMockFetch([{ status: 401, body: { error: "unauthorized" } }]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => "invalid-key",
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			await expect(client.getBookingContext(BOOKING_ID)).rejects.toThrow(/Hemera API error 401/);
		});
	});

	describe("idempotent workflow create/update (PUT /api/service/bookings/{bookingId}/seminar-recordings/{recordingId})", () => {
		it("sends the Idempotency-Key header and validates the workflow response", async () => {
			const { fetchFn, calls } = createMockFetch([{ status: 200, body: WORKFLOW_RECORD }]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			const update = WorkflowUpdateSchema.parse({
				status: "queued",
				recordingDate: "2026-09-30T10:15:00.000Z",
				sourceBlobPathname: WORKFLOW_RECORD.sourceBlobPathname,
			});
			const result = await client.upsertWorkflow(
				BOOKING_ID,
				RECORDING_ID,
				update,
				IDEMPOTENCY_HEADER,
			);

			expect(calls[0].url).toBe(
				`https://hemera.test.local/api/service/bookings/${BOOKING_ID}/seminar-recordings/${RECORDING_ID}`,
			);
			expect(calls[0].init?.method).toBe("PUT");
			expect((calls[0].init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(
				IDEMPOTENCY_HEADER,
			);
			expect(result.status).toBe("queued");
			expect(() => SeminarRecordingWorkflowSchema.parse(result)).not.toThrow();
		});

		it("rejects a workflow update with an invalid status value", () => {
			expect(() =>
				WorkflowUpdateSchema.parse({
					status: "invalid_status",
					recordingDate: "2026-09-30T10:15:00.000Z",
				}),
			).toThrow();
		});

		it("rejects stage attempt counts above five", () => {
			expect(() =>
				WorkflowUpdateSchema.parse({
					status: "retryable_failure",
					recordingDate: "2026-09-30T10:15:00.000Z",
					stageAttemptCounts: { assemblyai_submit: 6 },
				}),
			).toThrow();
		});

		it("throws on 409 for a booking/participant mismatch", async () => {
			const { fetchFn } = createMockFetch([{ status: 409, body: { error: "mismatch" } }]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			await expect(
				client.upsertWorkflow(
					BOOKING_ID,
					RECORDING_ID,
					WorkflowUpdateSchema.parse({
						status: "queued",
						recordingDate: "2026-09-30T10:15:00.000Z",
					}),
					IDEMPOTENCY_HEADER,
				),
			).rejects.toThrow(/Hemera API error 409/);
		});
	});

	describe("workflow read (GET /api/service/bookings/{bookingId}/seminar-recordings/{recordingId})", () => {
		it("returns the canonical workflow record for reconciliation", async () => {
			const { fetchFn } = createMockFetch([{ status: 200, body: WORKFLOW_RECORD }]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			const result = await client.getWorkflow(BOOKING_ID, RECORDING_ID);

			expect(result.recordingId).toBe(RECORDING_ID);
			expect(() => SeminarRecordingWorkflowSchema.parse(result)).not.toThrow();
		});
	});

	describe("queued-job listing (GET /api/service/seminar-recording-jobs)", () => {
		it("requests oldest-first workflows for the given statuses", async () => {
			const { fetchFn, calls } = createMockFetch([
				{ status: 200, body: { items: [WORKFLOW_RECORD] } },
			]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			const result = await client.listJobs(["queued", "retryable_failure"], 20);

			expect(calls[0].url).toContain("/api/service/seminar-recording-jobs");
			expect(calls[0].url).toContain("status=queued,retryable_failure");
			expect(calls[0].url).toContain("limit=20");
			expect(result.items).toHaveLength(1);
			expect(() => SeminarRecordingWorkflowSchema.parse(result.items[0])).not.toThrow();
		});

		it("validates the status enum before sending the request", () => {
			expect(() => WorkflowStatusSchema.parse("queued")).not.toThrow();
			expect(() => WorkflowStatusSchema.parse("not_a_status")).toThrow();
		});
	});

	describe("deletion acknowledgment (PUT with deletionConfirmedAt)", () => {
		it("reports cleanup confirmation only through the workflow update contract", async () => {
			const { fetchFn, calls } = createMockFetch([
				{
					status: 200,
					body: {
						...WORKFLOW_RECORD,
						status: "deleted",
						deletionConfirmedAt: "2026-09-30T11:00:00.000Z",
					},
				},
			]);
			client = new HemeraSeminarRecordingClient({
				baseUrl: "https://hemera.test.local",
				getToken: async () => TEST_AUTH_HEADER_VALUE,
				fetchFn: fetchFn as unknown as typeof fetch,
			});

			const update = WorkflowUpdateSchema.parse({
				status: "deleted",
				recordingDate: WORKFLOW_RECORD.recordingDate,
				deletionConfirmedAt: "2026-09-30T11:00:00.000Z",
			});
			const result = await client.upsertWorkflow(
				BOOKING_ID,
				RECORDING_ID,
				update,
				IDEMPOTENCY_HEADER,
			);

			expect(calls[0].init?.method).toBe("PUT");
			expect(result.deletionConfirmedAt).toBe("2026-09-30T11:00:00.000Z");
		});
	});
});
