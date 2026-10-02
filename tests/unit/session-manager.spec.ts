// ---------------------------------------------------------------------------
// Unit Tests: Session Manager
// Task: T012 [P] [US1] — Start/stop lifecycle, mutex guard, auto-stop at
//                         15 min, state transitions, _resetState
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		WEBCAM_STREAM_URL: "rtsp://192.168.1.100:554/stream",
		RECORDINGS_OUTPUT_DIR: "output/recordings",
	}),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	stat: vi.fn().mockResolvedValue({ size: 1024000 }),
}));

const mockExited = Promise.resolve({ code: 0, signal: null });

vi.mock("@/lib/recording/ffmpeg-capture", () => ({
	isFFmpegAvailable: vi.fn().mockResolvedValue(true),
	spawnFFmpeg: vi.fn().mockReturnValue({
		child: {
			pid: 12345,
			killed: false,
			kill: vi.fn(),
			on: vi.fn(),
		},
		exited: mockExited,
		stderrLines: [],
	}),
	stopFFmpeg: vi.fn().mockResolvedValue({ code: 0, signal: "SIGINT" }),
	parseFFmpegError: vi.fn().mockReturnValue(null),
}));

describe("Session Manager", () => {
	let sessionManager: typeof import("@/lib/recording/session-manager");
	const booking = {
		bookingId: "booking-123",
		participantUserId: "participant-456",
		courseId: "course-789",
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		// Re-import to get fresh module state
		sessionManager = await import("@/lib/recording/session-manager");
		sessionManager._resetState();
	});

	afterEach(() => {
		sessionManager._resetState();
	});

	describe("startRecording", () => {
		it("starts a recording session successfully", async () => {
			const session = await sessionManager.startRecording(booking);

			expect(session).toBeDefined();
			expect(session.sessionId).toMatch(/^rec_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
			expect(session.bookingId).toBe(booking.bookingId);
			expect(session.participantUserId).toBe(booking.participantUserId);
			expect(session.status).toBe("recording");
			expect(session.filename).toMatch(/\.mp4$/);
			expect(session.startedAt).toBeDefined();
			expect(session.endedAt).toBeNull();
			expect(session.duration).toBeNull();
			expect(session.maxDurationReached).toBe(false);
		});

		it("throws CONFLICT when a session is already active", async () => {
			await sessionManager.startRecording(booking);

			await expect(sessionManager.startRecording(booking)).rejects.toThrow("CONFLICT:");
		});

		it("throws FFMPEG_NOT_FOUND when FFmpeg is not installed", async () => {
			const { isFFmpegAvailable } = await import("@/lib/recording/ffmpeg-capture");
			vi.mocked(isFFmpegAvailable).mockResolvedValueOnce(false);

			await expect(sessionManager.startRecording(booking)).rejects.toThrow("FFMPEG_NOT_FOUND:");
		});

		it("throws WEBCAM_UNREACHABLE when stream URL is not configured", async () => {
			const { loadConfig } = await import("@/lib/config");
			vi.mocked(loadConfig).mockReturnValueOnce({
				WEBCAM_STREAM_URL: undefined,
				RECORDINGS_OUTPUT_DIR: "output/recordings",
			} as ReturnType<typeof loadConfig>);

			await expect(sessionManager.startRecording(booking)).rejects.toThrow("WEBCAM_UNREACHABLE:");
		});
	});

	describe("stopRecording", () => {
		it("stops an active recording session", async () => {
			await sessionManager.startRecording(booking);
			const session = await sessionManager.stopRecording();

			expect(session.status).toBe("completed");
			expect(session.endedAt).toBeDefined();
			expect(session.duration).toBeGreaterThanOrEqual(0);
			await expect(sessionManager.stopRecording()).resolves.toBe(session);
		});

		it("throws NOT_FOUND when no session is active", async () => {
			await expect(sessionManager.stopRecording()).rejects.toThrow("NOT_FOUND:");
		});
	});

	describe("getSessionState", () => {
		it("returns null when no session exists", () => {
			expect(sessionManager.getSessionState()).toBeNull();
		});

		it("returns the current session", async () => {
			await sessionManager.startRecording(booking);
			const state = sessionManager.getSessionState();

			expect(state).toBeDefined();
			expect(state?.status).toBe("recording");
		});
	});

	describe("isRecording", () => {
		it("returns false when no session is active", () => {
			expect(sessionManager.isRecording()).toBe(false);
		});

		it("returns true when recording is in progress", async () => {
			await sessionManager.startRecording(booking);
			expect(sessionManager.isRecording()).toBe(true);
		});
	});

	describe("_resetState", () => {
		it("clears all state", async () => {
			await sessionManager.startRecording(booking);
			sessionManager._resetState();

			expect(sessionManager.getSessionState()).toBeNull();
			expect(sessionManager.isRecording()).toBe(false);
		});
	});
});
