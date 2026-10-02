// ---------------------------------------------------------------------------
// Unit Tests: Role Mapping Validation
// Task: T018 [P] [US1] — Exact two-role one-to-one mapping, unmapped
// utterance, same speaker for both roles, missing speaker, empty role
// content, one detected speaker, failed identification, operator-required
// review, and operator mapping validation.
// ---------------------------------------------------------------------------

import { validateOperatorMapping, validateRoleMapping } from "@/lib/transcription/role-mapping";
import { describe, expect, it } from "vitest";

const UTTERANCES = [
	{ speakerId: "A", text: "Guten Tag, willkommen zum Seminar.", startMs: 0 },
	{ speakerId: "B", text: "Vielen Dank für die Einladung.", startMs: 4200 },
];

describe("validateRoleMapping (automatic)", () => {
	it("accepts an exact two-role one-to-one mapping", () => {
		const result = validateRoleMapping(
			{ status: "success", speakers: { Seminarleiter: "A", Teilnehmerin: "B" } },
			UTTERANCES,
		);
		expect(result.valid).toBe(true);
	});

	it("rejects a failed speaker identification", () => {
		const result = validateRoleMapping({ status: "error", speakers: undefined }, UTTERANCES);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("review_required");
	});

	it("rejects a missing role in the identification result", () => {
		const result = validateRoleMapping(
			{ status: "success", speakers: { Seminarleiter: "A" } },
			UTTERANCES,
		);
		expect(result.valid).toBe(false);
	});

	it("rejects the same speaker assigned to both roles", () => {
		const result = validateRoleMapping(
			{ status: "success", speakers: { Seminarleiter: "A", Teilnehmerin: "A" } },
			UTTERANCES,
		);
		expect(result.valid).toBe(false);
	});

	it("rejects a single detected speaker", () => {
		const result = validateRoleMapping(
			{ status: "success", speakers: { Seminarleiter: "A", Teilnehmerin: "B" } },
			[UTTERANCES[0]],
		);
		expect(result.valid).toBe(false);
	});

	it("rejects empty role content", () => {
		const result = validateRoleMapping(
			{ status: "success", speakers: { Seminarleiter: "A", Teilnehmerin: "B" } },
			[UTTERANCES[0], { speakerId: "B", text: "  ", startMs: 4200 }],
		);
		expect(result.valid).toBe(false);
	});
});

describe("validateOperatorMapping (manual review)", () => {
	it("accepts a corrected distinct mapping present in the transcript", () => {
		const result = validateOperatorMapping("B", "A", UTTERANCES);
		expect(result.valid).toBe(true);
		expect(result.mapping.Seminarleiter).toBe("B");
		expect(result.mapping.Teilnehmerin).toBe("A");
	});

	it("rejects both roles mapped to the same speaker", () => {
		const result = validateOperatorMapping("A", "A", UTTERANCES);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("roles_not_distinct");
	});

	it("rejects a speaker ID not present in the transcript", () => {
		const result = validateOperatorMapping("A", "Z", UTTERANCES);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("speaker_not_in_transcript");
	});

	it("rejects a mapping where a role has no content", () => {
		const result = validateOperatorMapping("A", "B", [
			UTTERANCES[0],
			{ speakerId: "B", text: " ", startMs: 4200 },
		]);
		expect(result.valid).toBe(false);
	});

	it("rejects one visible grapheme with multiple UTF-16 code units", () => {
		const result = validateOperatorMapping("A", "B", [
			{ speakerId: "A", text: "a\u0308", startMs: 0 },
			{ speakerId: "B", text: "Vielen Dank.", startMs: 4200 },
		]);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("role_Seminarleiter_no_content");
	});
});
