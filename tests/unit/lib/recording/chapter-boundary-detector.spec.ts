// ---------------------------------------------------------------------------
// Unit Tests: Chapter Boundary Detector (Spec 010)
// Task: T024 — chapter-boundary SSE event emission, dedupe, tolerance.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearBoundaryDetection,
	initBoundaryDetection,
	processPositionUpdate,
	validateChapterId,
} from "@/lib/recording/chapter-boundary-detector";

const mockDispatchSSE = vi.fn();

vi.mock("@/lib/recording/playback-controller", () => ({
	dispatchSSE: (...args: unknown[]) => mockDispatchSSE(...args),
}));

const mockReportError = vi.fn();
vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: (...args: unknown[]) => mockReportError(...args),
}));

const RECORDING_ID = "rec_test";
const CHAPTERS = [
	{ id: 0, start: 0, end: 10, title: "Chapter 1" },
	{ id: 1, start: 10, end: 20, title: "Chapter 2" },
	{ id: 2, start: 20, end: 30, title: "Chapter 3" },
];

beforeEach(() => {
	mockDispatchSSE.mockClear();
	initBoundaryDetection(RECORDING_ID, CHAPTERS);
});

afterEach(() => {
	clearBoundaryDetection(RECORDING_ID);
});

describe("processPositionUpdate (T024)", () => {
	it("emits chapter-boundary event when position reaches chapter.end", () => {
		const emitted = processPositionUpdate(RECORDING_ID, 10.0);
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toEqual({ chapterId: 0, nextChapterId: 1 });
		expect(mockDispatchSSE).toHaveBeenCalledWith(RECORDING_ID, {
			action: "chapter-boundary",
			chapterId: 0,
			nextChapterId: 1,
		});
	});

	it("emits within ±500 ms tolerance (position 9.5 triggers boundary for end=10)", () => {
		const emitted = processPositionUpdate(RECORDING_ID, 9.5);
		expect(emitted).toHaveLength(1);
		expect(emitted[0].chapterId).toBe(0);
	});

	it("does not emit when position is before chapter.end (more than 500 ms)", () => {
		const emitted = processPositionUpdate(RECORDING_ID, 9.4);
		expect(emitted).toHaveLength(0);
		expect(mockDispatchSSE).not.toHaveBeenCalled();
	});

	it("emits exactly one event per boundary (dedupe on re-call)", () => {
		processPositionUpdate(RECORDING_ID, 10.0);
		const secondCall = processPositionUpdate(RECORDING_ID, 10.5);
		expect(secondCall).toHaveLength(0);
		expect(mockDispatchSSE).toHaveBeenCalledTimes(1);
	});

	it("emits multiple boundaries when position crosses multiple chapters", () => {
		const emitted = processPositionUpdate(RECORDING_ID, 25.0);
		expect(emitted).toHaveLength(2);
		expect(emitted[0].chapterId).toBe(0);
		expect(emitted[1].chapterId).toBe(1);
	});

	it("emits all boundaries when position reaches final chapter end", () => {
		const emitted = processPositionUpdate(RECORDING_ID, 30.0);
		expect(emitted).toHaveLength(3);
		expect(emitted[0].chapterId).toBe(0);
		expect(emitted[1].chapterId).toBe(1);
		expect(emitted[2].chapterId).toBe(2);
	});

	it("omits nextChapterId for final chapter", () => {
		const emitted = processPositionUpdate(RECORDING_ID, 30.0);
		const finalEvent = emitted.find((e) => e.chapterId === 2);
		expect(finalEvent).toBeDefined();
		expect(finalEvent?.nextChapterId).toBeUndefined();
	});

	it("returns empty array for unknown recordingId", () => {
		const emitted = processPositionUpdate("unknown_recording", 10.0);
		expect(emitted).toHaveLength(0);
	});
});

describe("validateChapterId", () => {
	it("returns true for valid chapterId", () => {
		const result = validateChapterId(RECORDING_ID, 1, CHAPTERS);
		expect(result).toBe(true);
	});

	it("returns false and logs warning for out-of-range chapterId", () => {
		const result = validateChapterId(RECORDING_ID, 99, CHAPTERS);
		expect(result).toBe(false);
		expect(mockReportError).toHaveBeenCalledOnce();
	});

	it("returns false for negative chapterId", () => {
		const result = validateChapterId(RECORDING_ID, -1, CHAPTERS);
		expect(result).toBe(false);
	});
});
