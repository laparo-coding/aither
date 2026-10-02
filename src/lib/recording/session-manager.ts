// ---------------------------------------------------------------------------
// Recording Session Manager
// Task: T007 — Start/stop lifecycle, single-session mutex, auto-stop timer
//              at 15 min, warning at 14 min, _getState()/_resetState() for
//              tests
// ---------------------------------------------------------------------------

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { reportError } from "@/lib/monitoring/rollbar-official";
import type { BookingContext } from "@/lib/transcription/types";
import {
	type FFmpegProcess,
	isFFmpegAvailable,
	parseFFmpegError,
	spawnFFmpeg,
	stopFFmpeg,
} from "./ffmpeg-capture";
import type { RecordingSession } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────

/** Maximum recording duration in ms (15 minutes) */
const MAX_DURATION_MS = 15 * 60 * 1000;

/** Warning threshold in ms (14 minutes) */
const WARNING_THRESHOLD_MS = 14 * 60 * 1000;

// ── In-memory state (transient, Constitution VII) ─────────────────────────

let currentSession: RecordingSession | null = null;
let currentFFmpeg: FFmpegProcess | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
let warningTimer: ReturnType<typeof setTimeout> | null = null;
let warningEmitted = false;

// ── Helpers ───────────────────────────────────────────────────────────────

function generateSessionId(): string {
	const now = new Date();
	const ts = now.toISOString().replace(/[:.]/g, "-").replace("Z", "").slice(0, 19);
	return `rec_${ts}Z`;
}

function getOutputDir(): string {
	try {
		const config = loadConfig();
		return config.RECORDINGS_OUTPUT_DIR;
	} catch {
		return "output/recordings";
	}
}

function updateSession(fields: Partial<RecordingSession>): void {
	if (currentSession) {
		Object.assign(currentSession, fields);
	}
}

function clearTimers(): void {
	if (autoStopTimer) {
		clearTimeout(autoStopTimer);
		autoStopTimer = null;
	}
	if (warningTimer) {
		clearTimeout(warningTimer);
		warningTimer = null;
	}
	warningEmitted = false;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Start a new recording session.
 *
 * @returns The session data on success.
 * @throws Error with message starting with the error type:
 *   - "CONFLICT:" if a session is already active
 *   - "FFMPEG_NOT_FOUND:" if FFmpeg is not installed
 *   - "WEBCAM_UNREACHABLE:" if the stream fails to start
 */
export async function startRecording(booking: BookingContext): Promise<RecordingSession> {
	// Mutex: reject concurrent session
	if (
		currentSession &&
		(currentSession.status === "starting" || currentSession.status === "recording")
	) {
		throw new Error(
			`CONFLICT: A recording session is already in progress (${currentSession.sessionId})`,
		);
	}

	// Verify FFmpeg availability
	const ffmpegOk = await isFFmpegAvailable();
	if (!ffmpegOk) {
		throw new Error("FFMPEG_NOT_FOUND: FFmpeg is not installed or not in PATH");
	}

	// Load config for stream URL
	let streamUrl: string;
	try {
		const config = loadConfig();
		if (!config.WEBCAM_STREAM_URL) {
			throw new Error("WEBCAM_UNREACHABLE: WEBCAM_STREAM_URL environment variable is not set");
		}
		streamUrl = config.WEBCAM_STREAM_URL;
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("WEBCAM_UNREACHABLE:")) {
			throw err;
		}
		throw new Error("WEBCAM_UNREACHABLE: Failed to load configuration");
	}

	// Create output directory
	const outputDir = getOutputDir();
	await mkdir(outputDir, { recursive: true });

	// Generate session
	const sessionId = generateSessionId();
	const filename = `${sessionId}.mp4`;
	const filePath = join(outputDir, filename);

	currentSession = {
		sessionId,
		bookingId: booking.bookingId,
		participantUserId: booking.participantUserId,
		filename,
		status: "starting",
		startedAt: new Date().toISOString(),
		endedAt: null,
		duration: null,
		fileSize: null,
		filePath,
		maxDurationReached: false,
		error: null,
	};

	// Spawn FFmpeg
	try {
		currentFFmpeg = spawnFFmpeg({ streamUrl, outputPath: filePath });
	} catch (err) {
		updateSession({
			status: "failed",
			endedAt: new Date().toISOString(),
			error: err instanceof Error ? err.message : String(err),
		});
		throw new Error(
			`WEBCAM_UNREACHABLE: Failed to spawn FFmpeg — ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Mark as recording
	updateSession({ status: "recording" });

	// Set up auto-stop timer (15 minutes)
	autoStopTimer = setTimeout(async () => {
		if (currentSession?.status === "recording") {
			updateSession({ maxDurationReached: true });
			try {
				await stopRecording();
			} catch (err) {
				reportError(err instanceof Error ? err : new Error(String(err)), undefined, "error");
			}
		}
	}, MAX_DURATION_MS);

	// Set up warning timer (14 minutes)
	warningTimer = setTimeout(() => {
		if (currentSession?.status === "recording") {
			warningEmitted = true;
			reportError(
				new Error(`Recording ${sessionId} approaching 15-minute limit (14 min reached)`),
				undefined,
				"warning",
			);
		}
	}, WARNING_THRESHOLD_MS);

	// Handle FFmpeg unexpected exit
	const ff = currentFFmpeg;
	ff.exited.then(({ code }) => {
		if (currentSession?.status === "recording" && code !== 0) {
			const errorMsg = parseFFmpegError(ff?.stderrLines ?? []);
			updateSession({
				status: "interrupted",
				endedAt: new Date().toISOString(),
				error: errorMsg || `FFmpeg exited unexpectedly with code ${code}`,
			});
			clearTimers();
		}
	});

	return currentSession;
}

/**
 * Stop the active recording session gracefully.
 *
 * @returns The completed session data with file info.
 * @throws Error with "NOT_FOUND:" if no active session.
 */
export async function stopRecording(): Promise<RecordingSession> {
	if (currentSession?.status === "completed") {
		return currentSession;
	}

	if (
		!currentSession ||
		(currentSession.status !== "recording" && currentSession.status !== "starting")
	) {
		throw new Error("NOT_FOUND: No active recording session");
	}

	if (!currentFFmpeg) {
		throw new Error("NOT_FOUND: No FFmpeg process to stop");
	}

	updateSession({ status: "stopping" });
	clearTimers();

	// Graceful stop
	const result = await stopFFmpeg(currentFFmpeg);

	const endedAt = new Date().toISOString();
	const startMs = new Date(currentSession.startedAt).getTime();
	const endMs = new Date(endedAt).getTime();
	const duration = Math.round((endMs - startMs) / 1000);

	// Try to get file size
	let fileSize = 0;
	try {
		const { stat } = await import("node:fs/promises");
		const stats = await stat(currentSession.filePath);
		fileSize = stats.size;
	} catch {
		// File may not exist if FFmpeg failed
	}

	const errorMsg =
		result.code !== 0 && result.signal !== "SIGINT"
			? parseFFmpegError(currentFFmpeg.stderrLines)
			: null;

	updateSession({
		status: errorMsg ? "failed" : "completed",
		endedAt,
		duration,
		fileSize,
		error: errorMsg,
	});

	currentFFmpeg = null;

	return currentSession;
}

/**
 * Get the current session state (or null if no session).
 */
export function getSessionState(): RecordingSession | null {
	return currentSession;
}

/**
 * Check if a recording session is currently active.
 */
export function isRecording(): boolean {
	return currentSession?.status === "recording" || currentSession?.status === "starting";
}

// ── Test Helpers ──────────────────────────────────────────────────────────

/** Expose internal state for testing. */
export function _getState() {
	return {
		currentSession,
		currentFFmpeg,
		autoStopTimer,
		warningTimer,
		warningEmitted,
	};
}

/** Reset all internal state for test isolation. */
export function _resetState(): void {
	clearTimers();
	if (currentFFmpeg && !currentFFmpeg.child.killed) {
		currentFFmpeg.child.kill("SIGKILL");
	}
	currentSession = null;
	currentFFmpeg = null;
}
