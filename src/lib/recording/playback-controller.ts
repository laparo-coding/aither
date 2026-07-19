// ---------------------------------------------------------------------------
// Playback Controller
// Task: T009 [P] — Playback state machine, SSE client registry Map,
//                  command dispatch to connected controllers, seek
//                  calculation, _resetState() for tests
// ---------------------------------------------------------------------------

import type { PlaybackState, PlayerStateType, SSECommand } from "./types";

// ── In-memory state (transient, Constitution VII) ─────────────────────────

/** Map of recordingId → PlaybackState */
const playbackStates = new Map<string, PlaybackState>();

/** Map of recordingId → Set of SSE controllers */
const sseClients = new Map<string, Set<ReadableStreamDefaultController>>();

// ── SSE Client Registry ───────────────────────────────────────────────────

/**
 * Register an SSE client controller for a recording.
 * Creates the PlaybackState entry if it doesn't exist.
 */
export function registerClient(
	recordingId: string,
	controller: ReadableStreamDefaultController,
): void {
	// Add to client registry
	if (!sseClients.has(recordingId)) {
		sseClients.set(recordingId, new Set());
	}
	sseClients.get(recordingId)?.add(controller);

	// Create playback state if not exists
	if (!playbackStates.has(recordingId)) {
		playbackStates.set(recordingId, {
			recordingId,
			state: "idle",
			position: 0,
			connectedAt: new Date().toISOString(),
			lastUpdated: new Date().toISOString(),
			errorMessage: null,
		});
	}
}

/**
 * Unregister an SSE client controller.
 * Removes the PlaybackState if no clients remain.
 */
export function unregisterClient(
	recordingId: string,
	controller: ReadableStreamDefaultController,
): void {
	const clients = sseClients.get(recordingId);
	if (clients) {
		clients.delete(controller);
		if (clients.size === 0) {
			sseClients.delete(recordingId);
			playbackStates.delete(recordingId);
		}
	}
}

/**
 * Check if any SSE client is connected for a recording.
 */
export function hasConnectedClients(recordingId: string): boolean {
	const clients = sseClients.get(recordingId);
	return !!clients && clients.size > 0;
}

/**
 * Close all SSE connections for a recording (e.g., on delete).
 */
export function closeClientsForRecording(recordingId: string): void {
	const clients = sseClients.get(recordingId);
	if (clients) {
		for (const controller of clients) {
			try {
				controller.close();
			} catch {
				// Controller may already be closed
			}
		}
		sseClients.delete(recordingId);
		playbackStates.delete(recordingId);
	}
}

// ── Command Dispatch ──────────────────────────────────────────────────────

/**
 * Send an SSE command to all connected clients for a recording.
 */
export function dispatchSSE(recordingId: string, command: SSECommand): void {
	const clients = sseClients.get(recordingId);
	if (!clients) return;

	const data = `event: command\ndata: ${JSON.stringify(command)}\n\n`;
	const encoded = new TextEncoder().encode(data);

	for (const controller of clients) {
		try {
			controller.enqueue(encoded);
		} catch {
			// Client disconnected — will be cleaned up by abort handler
		}
	}
}

/**
 * Update the playback state and dispatch an SSE command.
 *
 * @returns The new state and position, or null if no player connected.
 */
export function dispatchCommand(
	recordingId: string,
	command: SSECommand,
): { status: PlayerStateType; position: number } | null {
	const state = playbackStates.get(recordingId);
	if (!state || !hasConnectedClients(recordingId)) {
		return null;
	}

	switch (command.action) {
		case "play":
			state.state = "playing";
			break;
		case "stop":
			state.state = "paused";
			break;
		case "seek":
			state.position = Math.max(0, command.position);
			break;
	}

	state.lastUpdated = new Date().toISOString();
	dispatchSSE(recordingId, command);

	return {
		status: state.state,
		position: state.position,
	};
}

/**
 * Calculate new position after a seek operation.
 * Clamps to [0, duration].
 */
export function calculateSeekPosition(
	currentPosition: number,
	offsetSeconds: number,
	duration?: number,
): number {
	const newPos = currentPosition + offsetSeconds;
	if (newPos < 0) return 0;
	if (duration !== undefined && newPos > duration) return duration;
	return newPos;
}

// ── Player State Reports ──────────────────────────────────────────────────

/**
 * Accept a player state report and update the playback state.
 */
export function updatePlayerState(
	recordingId: string,
	playerState: PlayerStateType,
	position: number,
	errorMessage?: string,
): boolean {
	const state = playbackStates.get(recordingId);
	if (!state) return false;

	state.state = playerState;
	state.position = position;
	state.lastUpdated = new Date().toISOString();
	state.errorMessage = errorMessage ?? null;

	return true;
}

/**
 * Get current playback state for a recording.
 */
export function getPlaybackState(recordingId: string): PlaybackState | null {
	return playbackStates.get(recordingId) ?? null;
}

// ── Test Helpers ──────────────────────────────────────────────────────────

/** Expose internal state for testing. */
export function _getState() {
	return { playbackStates, sseClients };
}

/** Reset all internal state for test isolation. */
export function _resetState(): void {
	// Close all SSE connections
	for (const [, clients] of sseClients) {
		for (const controller of clients) {
			try {
				controller.close();
			} catch {
				// ignore
			}
		}
	}
	sseClients.clear();
	playbackStates.clear();
}
