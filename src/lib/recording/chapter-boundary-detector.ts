// ---------------------------------------------------------------------------
// Chapter Boundary Detector (Spec 010)
// Task: T028 — Detect when player position ≥ chapter.end (within ±500 ms
//               tolerance), emit exactly one chapter-boundary SSE event per
//               crossed boundary via dispatchSSE, then pause player.
//               Dedupe key: recordingId:chapterId. Tick cadence ≤ 500 ms.
// ---------------------------------------------------------------------------

import { reportError } from "@/lib/monitoring/rollbar-official";
import { dispatchSSE } from "@/lib/recording/playback-controller";
import type { ChapterSummary } from "@/lib/recording/types";

const BOUNDARY_TOLERANCE_MS = 500;
const TICK_CADENCE_MS = 500;

interface RecordingBoundaryState {
	chapters: ChapterSummary[];
	emittedBoundaries: Set<string>;
	lastPosition: number;
}

const recordingStates = new Map<string, RecordingBoundaryState>();

function makeDedupeKey(recordingId: string, chapterId: number): string {
	return `${recordingId}:${chapterId}`;
}

/**
 * Initialize boundary detection for a recording with its chapter list.
 */
export function initBoundaryDetection(recordingId: string, chapters: ChapterSummary[]): void {
	recordingStates.set(recordingId, {
		chapters,
		emittedBoundaries: new Set<string>(),
		lastPosition: 0,
	});
}

/**
 * Clear boundary detection state for a recording (on stop/disconnect).
 */
export function clearBoundaryDetection(recordingId: string): void {
	recordingStates.delete(recordingId);
}

/**
 * Process a player position update and emit chapter-boundary events if needed.
 *
 * @param recordingId - Recording session id.
 * @param positionSeconds - Current player position in seconds.
 * @returns Array of emitted chapter boundary events (empty if none).
 */
export function processPositionUpdate(
	recordingId: string,
	positionSeconds: number,
): Array<{ chapterId: number; nextChapterId?: number }> {
	const state = recordingStates.get(recordingId);
	if (!state) {
		return [];
	}

	const emitted: Array<{ chapterId: number; nextChapterId?: number }> = [];
	const toleranceSeconds = BOUNDARY_TOLERANCE_MS / 1000;

	for (let i = 0; i < state.chapters.length; i++) {
		const chapter = state.chapters[i];
		const dedupeKey = makeDedupeKey(recordingId, chapter.id);

		// Skip already-emitted boundaries
		if (state.emittedBoundaries.has(dedupeKey)) {
			continue;
		}

		// Check if position has reached or crossed chapter.end (within tolerance)
		if (positionSeconds >= chapter.end - toleranceSeconds) {
			const nextChapter = state.chapters[i + 1];
			const event = {
				chapterId: chapter.id,
				nextChapterId: nextChapter?.id,
			};

			// Emit chapter-boundary SSE event
			dispatchSSE(recordingId, {
				action: "chapter-boundary",
				chapterId: event.chapterId,
				nextChapterId: event.nextChapterId,
			});

			// Mark as emitted (dedupe)
			state.emittedBoundaries.add(dedupeKey);
			emitted.push(event);
		}
	}

	state.lastPosition = positionSeconds;
	return emitted;
}

/**
 * Validate that a chapterId is in range for a recording's chapter list.
 * Logs a Rollbar warning if out of range (T029).
 */
export function validateChapterId(
	recordingId: string,
	chapterId: number,
	chapters: ChapterSummary[],
): boolean {
	const inRange = chapters.some((c) => c.id === chapterId);
	if (!inRange) {
		reportError(
			new Error(`Out-of-range chapterId ${chapterId} for recording ${recordingId}`),
			{
				route: "/api/recording/events",
				method: "GET",
				additionalData: { recordingId, chapterId, chapterCount: chapters.length },
			},
			"warning",
		);
	}
	return inRange;
}

export const BOUNDARY_TOLERANCE = BOUNDARY_TOLERANCE_MS;
export const BOUNDARY_TICK_CADENCE = TICK_CADENCE_MS;
