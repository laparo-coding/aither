// ---------------------------------------------------------------------------
// Transcription Workflow Domain Logic
// Task: T014 (partial) — Pure state transitions, utterance normalization, and
// automatic mapping acceptance criteria per FR-004/FR-015/FR-029.
// ---------------------------------------------------------------------------

import type { DiarizedUtterance, MappingValidationResult, WorkflowStatus } from "./types";

export type { WorkflowStatus } from "./types";

/** Allowed workflow status transitions (data-model lifecycle). */
const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
	queued: ["transcribing", "retryable_failure", "failed", "deletion_pending"],
	transcribing: [
		"transcript_ready",
		"review_required",
		"retryable_failure",
		"failed",
		"deletion_pending",
	],
	transcript_ready: [
		"review_required",
		"publishing",
		"retryable_failure",
		"failed",
		"deletion_pending",
	],
	review_required: ["publishing", "deletion_pending"],
	publishing: ["ready", "retryable_failure", "failed", "deletion_pending"],
	ready: ["deletion_pending"],
	retryable_failure: [
		"queued",
		"transcribing",
		"transcript_ready",
		"publishing",
		"failed",
		"deletion_pending",
	],
	failed: ["deletion_pending"],
	deletion_pending: ["deleted"],
	deleted: [],
};

/** Returns true when the from -> to status transition is allowed. */
export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
	return TRANSITIONS[from].includes(to);
}

/**
 * Normalizes an utterance by trimming Unicode whitespace.
 * FR-004/FR-015: an utterance counts as content only when at least two
 * visible characters remain after normalization.
 */
export function normalizeUtteranceText(text: string): string {
	// Unicode-aware whitespace trim
	return text
		.replace(/^[\s\u00A0\u2000-\u200B\u2028\u2029\uFEFF]+/u, "")
		.replace(/[\s\u00A0\u2000-\u200B\u2028\u2029\uFEFF]+$/u, "");
}

/** Counts visible grapheme clusters after trimming Unicode whitespace. */
export function countVisibleGraphemes(text: string): number {
	const normalized = normalizeUtteranceText(text);
	if (!normalized) return 0;

	const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
	let count = 0;
	for (const { segment } of segmenter.segment(normalized)) {
		if (/[\p{L}\p{N}\p{P}\p{S}]/u.test(segment)) count += 1;
	}
	return count;
}

export interface AutomaticMappingInput {
	speakerIdentificationStatus: string;
	utterances: DiarizedUtterance[];
	mapping: Record<string, string>;
	roles: string[];
}

/**
 * Validates the automatic publication criteria (FR-004/FR-015/FR-029):
 * - Speaker Identification reported success
 * - Both roles map one-to-one to distinct speaker IDs
 * - Every utterance has a speaker ID
 * - Each role has at least one utterance with >= 2 visible characters
 * - Overlapping utterances stay separate, ordered by start time
 */
export function isValidAutomaticMapping(input: AutomaticMappingInput): MappingValidationResult {
	const { speakerIdentificationStatus, utterances, mapping, roles } = input;

	if (speakerIdentificationStatus !== "success") {
		return { valid: false, reason: "speaker_identification_not_successful; review_required" };
	}

	// One-to-one mapping to distinct speaker IDs
	const mappedSpeakers = roles.map((role) => mapping[role]);
	if (mappedSpeakers.some((speaker) => !speaker)) {
		return { valid: false, reason: "missing_role_mapping; review_required" };
	}
	if (new Set(mappedSpeakers).size !== roles.length) {
		return { valid: false, reason: "roles_not_distinct; review_required" };
	}

	// Every utterance must have a speaker ID and that ID must be mapped to a role
	const validSpeakerIds = new Set(mappedSpeakers);
	for (const u of utterances) {
		if (!u.speakerId) {
			return { valid: false, reason: "utterance_without_speaker; review_required" };
		}
		if (!validSpeakerIds.has(u.speakerId)) {
			return { valid: false, reason: "unmapped_speaker_id; review_required" };
		}
	}

	// Chronological order with overlapping utterances kept separate
	const ordered = [...utterances]
		.map((u) => ({
			speakerId: u.speakerId,
			text: u.text,
			start: u.startMs ?? 0,
		}))
		.sort((a, b) => a.start - b.start);

	// Each role needs at least one utterance with two or more visible characters
	for (const role of roles) {
		const speaker = mapping[role];
		const hasContent = ordered.some(
			(u) => u.speakerId === speaker && countVisibleGraphemes(u.text) >= 2,
		);
		if (!hasContent) {
			return { valid: false, reason: `role_${role}_no_content; review_required` };
		}
	}

	return { valid: true, reason: "ok", orderedUtterances: ordered };
}
