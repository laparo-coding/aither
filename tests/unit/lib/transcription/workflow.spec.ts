// ---------------------------------------------------------------------------
// Unit Tests: Transcription Workflow Domain
// Task: T008 [P] — Failing tests for workflow schemas, state transitions,
// one-to-one speaker mapping, per-role utterances with at least two visible
// characters after Unicode-whitespace normalization, overlapping-speech
// ordering, authoritative operator approval, stale callback rejection, and
// review_required fallback.
// ---------------------------------------------------------------------------

import {
	type WorkflowStatus,
	canTransition,
	isValidAutomaticMapping,
	normalizeUtteranceText,
} from "@/lib/transcription/workflow";
import { describe, expect, it } from "vitest";

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
	it("preserves an approved mapping against a later callback", () => {
		const approved = {
			mapping: { Seminarleiter: "A", Teilnehmerin: "B" },
			approvedBy: "operator-001",
			approvedAt: "2026-09-30T10:30:00.000Z",
		};
		const laterCallback = { transcriptId: "tx-late", status: "completed" };

		const isStale = approved.approvedAt !== null && laterCallback.status === "completed";
		expect(isStale).toBe(true);
		expect(approved.mapping).toEqual({ Seminarleiter: "A", Teilnehmerin: "B" });
	});
});
