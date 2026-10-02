// ---------------------------------------------------------------------------
// Contract Tests: Recording API
// Task: T013 [P] [US1] — POST start/stop shapes & status codes
// Task: T018 [P] [US2] — GET status/list, DELETE [id] shapes & status codes
// Task: T034 [P] [US6] — POST upload/[id] shapes & status codes
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth — bypass requireAdmin check
vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({
		status: 200,
		body: { sessionClaims: { metadata: { role: "admin" } } },
	}),
}));
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

// Mock config
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		WEBCAM_STREAM_URL: "rtsp://192.168.1.100:554/stream",
		RECORDINGS_OUTPUT_DIR: "output/recordings",
		MUX_TOKEN_ID: undefined,
		MUX_TOKEN_SECRET: undefined,
	}),
}));

// Mock monitoring
vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

// Session manager mock — default: no active session, start succeeds
const mockStartRecording = vi.fn().mockResolvedValue({
	sessionId: "rec_2025-01-15T10-30-00Z",
	status: "recording",
	filename: "rec_2025-01-15T10-30-00Z.mp4",
	startedAt: "2025-01-15T10:30:00.000Z",
	endedAt: null,
	duration: null,
	maxDurationReached: false,
	bookingId: "booking-001",
});

const mockStopRecording = vi.fn().mockResolvedValue({
	sessionId: "rec_2025-01-15T10-30-00Z",
	bookingId: "booking-001",
	status: "completed",
	filename: "rec_2025-01-15T10-30-00Z.mp4",
	filePath: "/tmp/rec_2025-01-15T10-30-00Z.mp4",
	startedAt: "2025-01-15T10:30:00.000Z",
	endedAt: "2025-01-15T10:35:00.000Z",
	duration: 300,
	maxDurationReached: false,
});

const mockGetSessionState = vi.fn().mockReturnValue(null);
const mockIsRecording = vi.fn().mockReturnValue(false);

vi.mock("@/lib/recording/session-manager", () => ({
	startRecording: (...args: unknown[]) => mockStartRecording(...args),
	stopRecording: (...args: unknown[]) => mockStopRecording(...args),
	getSessionState: (...args: unknown[]) => mockGetSessionState(...args),
	isRecording: (...args: unknown[]) => mockIsRecording(...args),
	_resetState: vi.fn(),
}));

const mockGetBookingContext = vi.fn().mockResolvedValue({
	bookingId: "booking-001",
	participantUserId: "participant-001",
	courseId: "course-001",
});
const mockUpsertWorkflow = vi.fn().mockResolvedValue({});
vi.mock("@/lib/transcription/hemera-seminar-client", () => ({
	createHemeraSeminarRecordingClient: () => ({
		getBookingContext: (...args: unknown[]) => mockGetBookingContext(...args),
		upsertWorkflow: (...args: unknown[]) => mockUpsertWorkflow(...args),
	}),
}));
vi.mock("@/lib/recording/source-staging", () => ({
	uploadRecordingToStaging: vi.fn().mockResolvedValue("seminar-sources/booking-001/recording.mp4"),
}));

// File manager mock (US2)
const mockListRecordings = vi.fn().mockResolvedValue([
	{
		id: "rec_2025-01-16T14-00-00Z",
		filename: "rec_2025-01-16T14-00-00Z.mp4",
		duration: 300,
		fileSize: 1024000,
		createdAt: "2025-01-16T14:00:00Z",
		filePath: "output/recordings/rec_2025-01-16T14-00-00Z.mp4",
	},
	{
		id: "rec_2025-01-15T10-30-00Z",
		filename: "rec_2025-01-15T10-30-00Z.mp4",
		duration: 180,
		fileSize: 512000,
		createdAt: "2025-01-15T10:30:00Z",
		filePath: "output/recordings/rec_2025-01-15T10-30-00Z.mp4",
	},
]);
const mockGetRecordingById = vi.fn().mockResolvedValue(null);
const mockDeleteRecording = vi.fn().mockResolvedValue(false);

vi.mock("@/lib/recording/file-manager", () => ({
	listRecordings: (...args: unknown[]) => mockListRecordings(...args),
	getRecordingById: (...args: unknown[]) => mockGetRecordingById(...args),
	deleteRecording: (...args: unknown[]) => mockDeleteRecording(...args),
	resolveFilePath: vi.fn().mockResolvedValue(null),
	parseFilename: vi.fn(),
	getDuration: vi.fn().mockResolvedValue(0),
}));

// Playback controller mock (needed for delete to stop playback)
vi.mock("@/lib/recording/playback-controller", () => ({
	closeClientsForRecording: vi.fn(),
	_resetState: vi.fn(),
}));

// MUX uploader mock (US6)
const mockUploadToMux = vi.fn().mockResolvedValue({
	muxAssetId: "asset-abc-123",
	muxPlaybackUrl: "https://stream.mux.com/playback-xyz.m3u8",
});

vi.mock("@/lib/recording/mux-uploader", () => ({
	uploadToMux: (...args: unknown[]) => mockUploadToMux(...args),
}));

// Transmit recording mock (US6)
const mockTransmitRecording = vi.fn().mockResolvedValue({
	success: true,
});

vi.mock("@/lib/sync/recording-transmitter", () => ({
	transmitRecording: (...args: unknown[]) => mockTransmitRecording(...args),
}));

// Hemera client mock (US6)
vi.mock("@/lib/hemera/factory", () => ({
	createHemeraClient: vi.fn().mockReturnValue({ baseUrl: "https://hemera.test" }),
}));

function createRequest(url: string, method = "POST"): NextRequest {
	return new NextRequest(new URL(url), {
		method,
		headers: { "Content-Type": "application/json" },
	});
}

function createJsonRequest(
	url: string,
	body: Record<string, unknown>,
	method = "POST",
): NextRequest {
	return new NextRequest(new URL(url), {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		// biome-ignore lint/suspicious/noExplicitAny: test helper requires flexible typing
	} as any);
}

describe("POST /api/recording/start", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsRecording.mockReturnValue(false);
	});

	it("returns 200 with session data on successful start", async () => {
		const { POST } = await import("@/app/api/recording/start/route");
		const req = createJsonRequest("http://localhost:3000/api/recording/start", {
			bookingId: "booking-001",
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("sessionId");
		expect(json.data).toHaveProperty("status", "recording");
		expect(json.data).toHaveProperty("filename");
		expect(json.data).toHaveProperty("startedAt");
	});

	it("returns 409 when a recording is already active", async () => {
		mockStartRecording.mockRejectedValueOnce(
			new Error("CONFLICT: A recording session is already active"),
		);

		const { POST } = await import("@/app/api/recording/start/route");
		const req = createJsonRequest("http://localhost:3000/api/recording/start", {
			bookingId: "booking-001",
		});
		const res = await POST(req);

		expect(res.status).toBe(409);
		const json = await res.json();
		expect(json.success).toBe(false);
		expect(json.error).toBeDefined();
	});

	it("returns 503 when webcam is unreachable", async () => {
		mockStartRecording.mockRejectedValueOnce(
			new Error("WEBCAM_UNREACHABLE: No stream URL configured"),
		);

		const { POST } = await import("@/app/api/recording/start/route");
		const req = createJsonRequest("http://localhost:3000/api/recording/start", {
			bookingId: "booking-001",
		});
		const res = await POST(req);

		expect(res.status).toBe(503);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 503 when FFmpeg is not found", async () => {
		mockStartRecording.mockRejectedValueOnce(
			new Error("FFMPEG_NOT_FOUND: ffmpeg is not installed"),
		);

		const { POST } = await import("@/app/api/recording/start/route");
		const req = createJsonRequest("http://localhost:3000/api/recording/start", {
			bookingId: "booking-001",
		});
		const res = await POST(req);

		expect(res.status).toBe(503);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 401 when not authenticated", async () => {
		const { requireAdmin } = await import("@/lib/auth/role-check");
		vi.mocked(requireAdmin).mockReturnValueOnce({
			status: 401,
			body: { error: "UNAUTHENTICATED" },
		});

		const { POST } = await import("@/app/api/recording/start/route");
		const req = createRequest("http://localhost:3000/api/recording/start");
		const res = await POST(req);

		expect(res.status).toBe(401);
	});
});

describe("POST /api/recording/stop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 200 with file details on successful stop", async () => {
		const { POST } = await import("@/app/api/recording/stop/route");
		const req = createRequest("http://localhost:3000/api/recording/stop");
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("sessionId");
		expect(json.data).toHaveProperty("status", "completed");
		expect(json.data).toHaveProperty("endedAt");
		expect(json.data).toHaveProperty("duration");
	});

	it("returns 404 when no recording is active", async () => {
		mockStopRecording.mockRejectedValueOnce(new Error("NOT_FOUND: No active recording session"));

		const { POST } = await import("@/app/api/recording/stop/route");
		const req = createRequest("http://localhost:3000/api/recording/stop");
		const res = await POST(req);

		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 401 when not authenticated", async () => {
		const { requireAdmin } = await import("@/lib/auth/role-check");
		vi.mocked(requireAdmin).mockReturnValueOnce({
			status: 401,
			body: { error: "UNAUTHENTICATED" },
		});

		const { POST } = await import("@/app/api/recording/stop/route");
		const req = createRequest("http://localhost:3000/api/recording/stop");
		const res = await POST(req);

		expect(res.status).toBe(401);
	});
});

// ---------------------------------------------------------------------------
// US2: Status / List / Delete
// ---------------------------------------------------------------------------

describe("GET /api/recording/status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 200 with recording:false when no session is active", async () => {
		mockGetSessionState.mockReturnValue(null);
		const { GET } = await import("@/app/api/recording/status/route");
		const req = createRequest("http://localhost:3000/api/recording/status", "GET");
		const res = await GET(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("recording", false);
	});

	it("returns 200 with session data when recording is active", async () => {
		mockGetSessionState.mockReturnValue({
			sessionId: "rec_2025-01-15T10-30-00Z",
			status: "recording",
			filename: "rec_2025-01-15T10-30-00Z.mp4",
			startedAt: "2025-01-15T10:30:00.000Z",
		});
		mockIsRecording.mockReturnValue(true);

		const { GET } = await import("@/app/api/recording/status/route");
		const req = createRequest("http://localhost:3000/api/recording/status", "GET");
		const res = await GET(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("recording", true);
		expect(json.data).toHaveProperty("session");
	});
});

describe("GET /api/recording/list", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 200 with sorted recordings array", async () => {
		const { GET } = await import("@/app/api/recording/list/route");
		const req = createRequest("http://localhost:3000/api/recording/list", "GET");
		const res = await GET(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("recordings");
		expect(json.data.recordings).toHaveLength(2);
		expect(json.data.recordings[0].id).toBe("rec_2025-01-16T14-00-00Z");
	});

	it("returns 200 with empty array when no recordings exist", async () => {
		mockListRecordings.mockResolvedValueOnce([]);

		const { GET } = await import("@/app/api/recording/list/route");
		const req = createRequest("http://localhost:3000/api/recording/list", "GET");
		const res = await GET(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data.recordings).toEqual([]);
	});
});

describe("DELETE /api/recording/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 200 when recording is deleted successfully", async () => {
		mockDeleteRecording.mockResolvedValueOnce(true);

		const { DELETE } = await import("@/app/api/recording/[id]/route");
		const req = createRequest(
			"http://localhost:3000/api/recording/rec_2025-01-15T10-30-00Z",
			"DELETE",
		);
		const res = await DELETE(req, { params: Promise.resolve({ id: "rec_2025-01-15T10-30-00Z" }) });

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
	});

	it("returns 404 when recording not found", async () => {
		mockDeleteRecording.mockResolvedValueOnce(false);

		const { DELETE } = await import("@/app/api/recording/[id]/route");
		const req = createRequest(
			"http://localhost:3000/api/recording/rec_2099-01-01T00-00-00Z",
			"DELETE",
		);
		const res = await DELETE(req, { params: Promise.resolve({ id: "rec_2099-01-01T00-00-00Z" }) });

		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.success).toBe(false);
	});
});

// ── US6: Upload to MUX ───────────────────────────────────────────────────

describe("POST /api/recording/upload/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsRecording.mockReturnValue(false);
		mockGetRecordingById.mockResolvedValue({
			id: "rec_2025-01-16T14-00-00Z",
			filename: "rec_2025-01-16T14-00-00Z.mp4",
			duration: 300,
			fileSize: 1024000,
			createdAt: "2025-01-16T14:00:00Z",
			filePath: "output/recordings/rec_2025-01-16T14-00-00Z.mp4",
		});
		mockUploadToMux.mockResolvedValue({
			muxAssetId: "asset-abc-123",
			muxPlaybackUrl: "https://stream.mux.com/playback-xyz.m3u8",
		});
		mockTransmitRecording.mockResolvedValue({ success: true });
	});

	it("returns 200 on successful upload and transmission", async () => {
		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest(
			"http://localhost:3000/api/recording/upload/rec_2025-01-16T14-00-00Z",
			{ seminarSourceId: "sem-42" },
		);
		const res = await POST(req, { params: Promise.resolve({ id: "rec_2025-01-16T14-00-00Z" }) });

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("muxAssetId", "asset-abc-123");
		expect(json.data).toHaveProperty("muxPlaybackUrl");
		expect(json.data).toHaveProperty("seminarSourceId", "sem-42");
		expect(json.data).toHaveProperty("transmitted", true);
		expect(json.data.transmissionError).toBeNull();
	});

	it("returns 207 when MUX succeeds but transmission fails", async () => {
		mockTransmitRecording.mockResolvedValueOnce({ success: false, error: "Network error" });

		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest(
			"http://localhost:3000/api/recording/upload/rec_2025-01-16T14-00-00Z",
			{ seminarSourceId: "sem-42" },
		);
		const res = await POST(req, { params: Promise.resolve({ id: "rec_2025-01-16T14-00-00Z" }) });

		expect(res.status).toBe(207);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data.transmitted).toBe(false);
		expect(json.data.transmissionError).toBe("Network error");
	});

	it("returns 404 when recording not found", async () => {
		mockGetRecordingById.mockResolvedValueOnce(null);

		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest("http://localhost:3000/api/recording/upload/nonexistent", {
			seminarSourceId: "sem-42",
		});
		const res = await POST(req, { params: Promise.resolve({ id: "nonexistent" }) });

		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 409 when a recording is currently active", async () => {
		mockIsRecording.mockReturnValueOnce(true);

		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest(
			"http://localhost:3000/api/recording/upload/rec_2025-01-16T14-00-00Z",
			{ seminarSourceId: "sem-42" },
		);
		const res = await POST(req, { params: Promise.resolve({ id: "rec_2025-01-16T14-00-00Z" }) });

		expect(res.status).toBe(409);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 503 when MUX credentials are not configured", async () => {
		mockUploadToMux.mockRejectedValueOnce(
			new Error("MUX_NOT_CONFIGURED: MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set"),
		);

		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest(
			"http://localhost:3000/api/recording/upload/rec_2025-01-16T14-00-00Z",
			{ seminarSourceId: "sem-42" },
		);
		const res = await POST(req, { params: Promise.resolve({ id: "rec_2025-01-16T14-00-00Z" }) });

		expect(res.status).toBe(503);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 502 when MUX upload fails", async () => {
		mockUploadToMux.mockRejectedValueOnce(
			new Error("MUX_UPLOAD_FAILED: Failed to create direct upload"),
		);

		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest(
			"http://localhost:3000/api/recording/upload/rec_2025-01-16T14-00-00Z",
			{ seminarSourceId: "sem-42" },
		);
		const res = await POST(req, { params: Promise.resolve({ id: "rec_2025-01-16T14-00-00Z" }) });

		expect(res.status).toBe(502);
		const json = await res.json();
		expect(json.success).toBe(false);
	});

	it("returns 400 for invalid request body", async () => {
		const { POST } = await import("@/app/api/recording/upload/[id]/route");
		const req = createJsonRequest(
			"http://localhost:3000/api/recording/upload/rec_2025-01-16T14-00-00Z",
			{},
		);
		const res = await POST(req, { params: Promise.resolve({ id: "rec_2025-01-16T14-00-00Z" }) });

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.success).toBe(false);
	});
});
