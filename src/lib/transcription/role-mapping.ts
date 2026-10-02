// ---------------------------------------------------------------------------
// Role Mapping Validator
// Task: T014 — Pure validation of diarized speaker IDs against the two
// seminar roles. Rejects missing, repeated, or unmapped speaker IDs and
// builds the one-to-one mapping from AssemblyAI Speaker Identification.
// ---------------------------------------------------------------------------

import type { DiarizedUtterance, MappingValidationResult, SeminarRole } from "./types";
import { SEMINAR_ROLES } from "./types";
import { countVisibleGraphemes, isValidAutomaticMapping } from "./workflow";

export interface SpeakerIdentificationResult {
	status: string;
	/** Speaker IDs reported by Speaker Identification, keyed by role. */
	speakers?: Record<string, string>;
}

/**
 * Validates an AssemblyAI Speaker Identification result against the
 * diarized utterances and builds the automatic role mapping (FR-004/FR-015).
 */
export function validateRoleMapping(
	identification: SpeakerIdentificationResult,
	utterances: DiarizedUtterance[],
): MappingValidationResult {
	if (identification.status !== "success" || !identification.speakers) {
		return {
			valid: false,
			reason: "speaker_identification_not_successful; review_required",
		};
	}

	const mapping: Record<string, string> = {};
	for (const role of SEMINAR_ROLES) {
		const speaker = identification.speakers[role];
		if (!speaker) {
			return { valid: false, reason: `role_${role}_unmapped; review_required` };
		}
		mapping[role] = speaker;
	}

	return isValidAutomaticMapping({
		speakerIdentificationStatus: identification.status,
		utterances,
		mapping,
		roles: [...SEMINAR_ROLES],
	});
}

/**
 * Validates an operator-corrected mapping before approval (FR-014).
 * Both roles must map to distinct speaker IDs present in the utterances.
 */
export function validateOperatorMapping(
	leaderSpeakerId: string,
	participantSpeakerId: string,
	utterances: DiarizedUtterance[],
): { valid: boolean; reason: string; mapping: Record<SeminarRole, string> } {
	const mapping: Record<SeminarRole, string> = {
		Seminarleiter: leaderSpeakerId,
		Teilnehmerin: participantSpeakerId,
	};

	if (leaderSpeakerId === participantSpeakerId) {
		return { valid: false, reason: "roles_not_distinct", mapping };
	}

	const knownSpeakers = new Set(
		utterances.map((u) => u.speakerId).filter((id): id is string => id !== null),
	);
	if (!knownSpeakers.has(leaderSpeakerId) || !knownSpeakers.has(participantSpeakerId)) {
		return { valid: false, reason: "speaker_not_in_transcript", mapping };
	}

	// Each role still needs at least one utterance with two visible characters
	for (const role of SEMINAR_ROLES) {
		const speaker = mapping[role];
		const hasContent = utterances.some(
			(u) => u.speakerId === speaker && countVisibleGraphemes(u.text) >= 2,
		);
		if (!hasContent) {
			return { valid: false, reason: `role_${role}_no_content`, mapping };
		}
	}

	return { valid: true, reason: "ok", mapping };
}
