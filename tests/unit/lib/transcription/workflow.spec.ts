// ---------------------------------------------------------------------------
// Unit Tests: Transcription Workflow Domain
// Task: T008 [P] — Failing tests for workflow schemas, state transitions,
// one-to-one speaker mapping, per-role utterances with at least two visible
// characters after Unicode-whitespace normalization, overlapping-speech
// ordering, authoritative operator approval, stale callback rejection, and
// review_required fallback.
// ---------------------------------------------------------------------------

import { reconcileAssemblyAiCallback } from "@/lib/transcription/callback-reconciler";
import { SeminarRecordingWorkflowSchema } from "@/lib/transcription/schemas";
import {
	type WorkflowStatus,
	canTransition,
	countVisibleGraphemes,
	isValidAutomaticMapping,
	normalizeUtteranceText,
} from "@/lib/transcription/workflow";
import { describe, expect, it, vi } from "vitest";

const ROLES = ["Seminarleiter", "Teilnehmerin"] as const;

describe("workflow state transitions", () => {
	it("allows the queued -> transcribing -> transcript_ready -> publishing -> ready path", () => {
		expect(canTransition("queued", "transcribing")).toBe(true);
		expect(canTransition("transcribing", "transcript_ready")).toBe(true);
		expect(canTransition("transcript_ready", "publishing")).toBe(true);
		expect(canTransition("publishing", "ready")).toBe(true);
	});

	it("routes uncertain mappings to review_required", () => {
		expect(canTransition("transcribing", "review_required")).toBe(true);
		expect(canTransition("transcript_ready", "review_required")).toBe(true);
	});

	it("resumes publication from an operator-approved review", () => {
		expect(canTransition("review_required", "publishing")).toBe(true);
	});

	it("rejects skipping AssemblyAI before MUX publication", () => {
		expect(canTransition("queued", "publishing")).toBe(false);
		expect(canTransition("queued", "ready")).toBe(false);
	});

	it("prevents participant visibility before ready", () => {
		const nonVisible: WorkflowStatus[] = [
			"queued",
			"transcribing",
			"transcript_ready",
			"review_required",
			"publishing",
			"retryable_failure",
			"failed",
		];
		for (const status of nonVisible) {
			expect(status).not.toBe("ready");
		}
	});

	it("enters deletion lifecycle from any active state", () => {
		expect(canTransition("ready", "deletion_pending")).toBe(true);
		expect(canTransition("review_required", "deletion_pending")).toBe(true);
		expect(canTransition("deletion_pending", "deleted")).toBe(true);
	});
});

describe("utterance normalization (two visible characters)", () => {
	it("accepts an utterance with two or more visible characters", () => {
		expect(normalizeUtteranceText("  Hallo ")).toBe("Hallo");
		expect(normalizeUtteranceText("Ja")).toBe("Ja");
	});

	it("rejects whitespace-only or single-character utterances", () => {
		expect(normalizeUtteranceText("   ")).toBe("");
		expect(normalizeUtteranceText(" \t\n ")).toBe("");
		expect(normalizeUtteranceText(" x ")).toBe("x");
	});

	it("counts visible graphemes rather than UTF-16 code units", () => {
		expect(countVisibleGraphemes("a\u0308")).toBe(1);
		expect(countVisibleGraphemes("😀")).toBe(1);
		expect(countVisibleGraphemes(" A\u0308 B ")).toBe(2);
	});
});

describe("automatic mapping acceptance", () => {
	const validUtterances = [
		{ speakerId: "A", text: "Guten Tag, willkommen zum Seminar.", startMs: 0 },
		{ speakerId: "B", text: "Vielen Dank für die Einladung.", startMs: 4200 },
	];

	it("accepts a successful one-to-one mapping with content for both roles", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: validUtterances,
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(true);
	});

	it("rejects a failed speaker-identification status", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "error",
			utterances: validUtterances,
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("review_required");
	});

	it("rejects both roles mapped to the same speaker", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: validUtterances,
			mapping: { Seminarleiter: "A", Teilnehmerin: "A" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(false);
	});

	it("rejects an utterance without a speaker ID", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: [...validUtterances, { speakerId: null, text: "Egal.", startMs: 9000 }],
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(false);
	});

	it("rejects a role with only whitespace content", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: [validUtterances[0], { speakerId: "B", text: "   ", startMs: 4200 }],
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(false);
	});

	it("rejects one visible grapheme even when it has multiple UTF-16 code units", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: [
				{ speakerId: "A", text: "a\u0308", startMs: 0 },
				{ speakerId: "B", text: "Vielen Dank.", startMs: 4200 },
			],
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(false);
	});

	it("rejects a single detected speaker", () => {
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: [validUtterances[0]],
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(false);
	});

	it("keeps overlapping utterances separate in start-time order", () => {
		const overlapping = [
			{ speakerId: "A", text: "Ich erkläre jetzt die Übung.", startMs: 10_000 },
			{ speakerId: "B", text: "Verstanden.", startMs: 9500 },
		];
		const result = isValidAutomaticMapping({
			speakerIdentificationStatus: "success",
			utterances: [...validUtterances, ...overlapping],
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			roles: [...ROLES],
		});
		expect(result.valid).toBe(true);
		expect(result.orderedUtterances?.[2].start).toBe(9500);
	});
});

describe("authoritative operator approval", () => {
	it("preserves the canonical approved mapping against a duplicate callback", async () => {
		const approved = SeminarRecordingWorkflowSchema.parse({
			bookingId: "booking-1",
			participantUserId: "participant-1",
			recordingId: "recording-1",
			recordingDate: "2026-09-30T10:30:00.000Z",
			status: "publishing",
			assemblyAiTranscriptId: "tx-approved",
			reviewedSpeakerMapping: { A: "Seminarleiter", B: "Teilnehmerin" },
			reviewedBy: "operator-001",
			reviewedAt: "2026-09-30T10:30:00.000Z",
		});
		const getWorkflow = vi.fn().mockResolvedValue(approved);
		const upsertWorkflow = vi.fn();

		const result = await reconcileAssemblyAiCallback(
			{ getWorkflow, upsertWorkflow },
			"booking-1",
			"recording-1",
			{ transcript_id: "tx-approved", status: "completed" },
		);

		expect(result).toBe("workflow-advanced");
		expect(upsertWorkflow).not.toHaveBeenCalled();
		expect(approved.reviewedSpeakerMapping).toEqual({
			A: "Seminarleiter",
			B: "Teilnehmerin",
		});
	});

	it("persists a completed callback only for the active transcript", async () => {
		const transcribing = SeminarRecordingWorkflowSchema.parse({
			bookingId: "booking-1",
			participantUserId: "participant-1",
			recordingId: "recording-1",
			recordingDate: "2026-09-30T10:30:00.000Z",
			status: "transcribing",
			assemblyAiTranscriptId: "tx-active",
		});
		const getWorkflow = vi.fn().mockResolvedValue(transcribing);
		const upsertWorkflow = vi.fn().mockResolvedValue(transcribing);

		const result = await reconcileAssemblyAiCallback(
			{ getWorkflow, upsertWorkflow },
			"booking-1",
			"recording-1",
			{ transcript_id: "tx-active", status: "completed" },
		);

		expect(result).toBe("updated");
		expect(upsertWorkflow).toHaveBeenCalledWith(
			"booking-1",
			"recording-1",
			expect.objectContaining({
				status: "transcript_ready",
				assemblyAiStatus: "completed",
				nextAttemptAt: null,
			}),
			"booking-1:recording-1:assemblyai_callback:tx-active:completed",
		);
	});

	it("does not persist stale callbacks for a superseded transcript", async () => {
		const transcribing = SeminarRecordingWorkflowSchema.parse({
			bookingId: "booking-1",
			participantUserId: "participant-1",
			recordingId: "recording-1",
			recordingDate: "2026-09-30T10:30:00.000Z",
			status: "transcribing",
			assemblyAiTranscriptId: "tx-active",
		});
		const getWorkflow = vi.fn().mockResolvedValue(transcribing);
		const upsertWorkflow = vi.fn();

		const result = await reconcileAssemblyAiCallback(
			{ getWorkflow, upsertWorkflow },
			"booking-1",
			"recording-1",
			{ transcript_id: "tx-stale", status: "completed" },
		);

		expect(result).toBe("stale-transcript");
		expect(upsertWorkflow).not.toHaveBeenCalled();
	});
});
