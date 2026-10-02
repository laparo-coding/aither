// ---------------------------------------------------------------------------
// Unit Tests: Transcript Blob & Signed MUX Playback
// Task: T010 [P] — Failing tests for deterministic private source-staging and
// transcript paths, scoped provider read URLs, UTF-8 role-labelled content,
// timestamp ordering, five-minute participant signed GET expiry, stable MUX
// reference handoff without bearer tokens, and MUX token expiry at least the
// video duration.
// ---------------------------------------------------------------------------

import {
	buildStablePlaybackReference,
	computeMuxTokenTtlSeconds,
} from "@/lib/recording/mux-uploader";
import {
	buildSourceStagingPathname,
	buildTranscriptPathname,
} from "@/lib/recording/source-staging";
import {
	TRANSCRIPT_URL_EXPIRY_SECONDS,
	buildTranscriptDocument,
} from "@/lib/recording/transcript-blob";
import { describe, expect, it } from "vitest";

describe("deterministic private paths", () => {
	it("derives a stable source-staging pathname from booking and recording", () => {
		const a = buildSourceStagingPathname("booking-001", "rec-abc");
		const b = buildSourceStagingPathname("booking-001", "rec-abc");
		expect(a).toBe(b);
		expect(a).toBe("seminar-sources/booking-001/rec-abc.mp4");
	});

	it("derives a stable transcript pathname distinct from staging", () => {
		const staging = buildSourceStagingPathname("booking-001", "rec-abc");
		const transcript = buildTranscriptPathname("booking-001", "rec-abc");
		expect(transcript).toBe("seminar-transcripts/booking-001/rec-abc.txt");
		expect(transcript).not.toBe(staging);
	});
});

describe("transcript document format", () => {
	it("renders UTF-8 role-labelled utterances in chronological order with timestamps", () => {
		const doc = buildTranscriptDocument([
			{ role: "Teilnehmerin", text: "Vielen Dank.", startMs: 4200 },
			{ role: "Seminarleiter", text: "Guten Tag!", startMs: 100 },
		]);
		const lines = doc.split("\n");
		expect(lines[0]).toContain("Seminarleiter");
		expect(lines[0]).toContain("Guten Tag!");
		expect(lines[1]).toContain("Teilnehmerin");
		expect(lines[1]).toContain("Vielen Dank.");
	});

	it("keeps overlapping utterances separate ordered by start time", () => {
		const doc = buildTranscriptDocument([
			{ role: "Seminarleiter", text: "Erste Übung.", startMs: 10_000 },
			{ role: "Teilnehmerin", text: "Verstanden.", startMs: 9_500 },
		]);
		const lines = doc.split("\n");
		expect(lines[0]).toContain("Verstanden.");
		expect(lines[1]).toContain("Erste Übung.");
	});
});

describe("participant access expiry", () => {
	it("expires transcript signed GET URLs after exactly five minutes", () => {
		expect(TRANSCRIPT_URL_EXPIRY_SECONDS).toBe(300);
	});

	it("computes a MUX token TTL covering the full video duration", () => {
		const videoDurationSeconds = 900;
		const ttl = computeMuxTokenTtlSeconds(videoDurationSeconds);
		expect(ttl).toBeGreaterThanOrEqual(videoDurationSeconds);
	});
});

describe("stable MUX reference handoff", () => {
	it("builds a stable reference without a signed token", () => {
		const reference = buildStablePlaybackReference("playback-abc-123");
		expect(reference).toBe("https://stream.mux.com/playback-abc-123.m3u8");
		expect(reference).not.toContain("token=");
		expect(reference).not.toContain("signature=");
	});
});
