// ---------------------------------------------------------------------------
// Contract Tests: POST /api/recording/playback/play with chapterId (Spec 010)
// Task: T022 — 200 with start/end, 404 CHAPTER_NOT_FOUND.
//               Assert player position lands within ±500 ms of chapter.start.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({ status: 200, body: {} }),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({ BLOB_READ_WRITE_TOKEN: "test-token" }),
}));

// Chaptered asset mapping mock
const mockGetChapteredAssetMapping = vi.fn();

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: (...args: unknown[]) => mockGetChapteredAssetMapping(...args),
}));

// Chapter extractor mock
const mockExtractChapters = vi.fn();

vi.mock("@/lib/recording/chapter-extractor", () => ({
	extractChapters: (...args: unknown[]) => mockExtractChapters(...args),
}));

// Playback controller mock
const mockDispatchCommand = vi.fn().mockReturnValue(true);

vi.mock("@/lib/recording/playback-controller", () => ({
	dispatchCommand: (...args: unknown[]) => mockDispatchCommand(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const RECORDING_ID = "rec_2026-07-13T10-30-00Z";
const VALID_MAPPING = {
	assetId: RECORDING_ID,
	muxAssetId: "mux_chapters_rec_2026-07-13T10-30-00Z",
	muxPlaybackUrl: "https://stream.mux.com/playback-xyz.mp4",
	chapterCount: 2,
	generatedAt: "2026-07-19T10:00:00.000Z",
};
const VALID_CHAPTER_LIST = {
	assetId: RECORDING_ID,
	chapters: [
		{ id: 0, start: 5.0, end: 20.0, title: "Chapter 1" },
		{ id: 1, start: 20.0, end: 45.0, title: "Chapter 2" },
	],
};

function makePlayRequest(body: unknown): NextRequest {
	const url = "http://localhost:3000/api/recording/playback/play";
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}) as NextRequest;
}

// ── Import route after mocks ───────────────────────────────────────────────

import { POST } from "@/app/api/recording/playback/play/route";

beforeEach(() => {
	mockGetChapteredAssetMapping.mockResolvedValue(VALID_MAPPING);
	mockExtractChapters.mockResolvedValue(VALID_CHAPTER_LIST);
	mockDispatchCommand.mockReturnValue(true);
});

describe("POST /api/recording/playback/play with chapterId (T022)", () => {
	it("returns 200 with start/end when chapterId is valid", async () => {
		const req = makePlayRequest({ recordingId: RECORDING_ID, chapterId: 1 });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).toHaveProperty("chapterId", 1);
		expect(data).toHaveProperty("start", 20.0);
		expect(data).toHaveProperty("end", 45.0);
	});

	it("dispatches seek to chapter.start before play (within ±500 ms tolerance)", async () => {
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID, chapterId: 0 });
		await POST(req);
		// Verify seek was dispatched with chapter.start (5.0 seconds)
		const seekCall = mockDispatchCommand.mock.calls.find(
			(c) => (c[1] as { action: string }).action === "seek",
		);
		expect(seekCall).toBeDefined();
		const seekPosition = (seekCall?.[1] as { position: number }).position;
		// SC-004: player position should land within ±500 ms (0.5 s) of chapter.start
		expect(Math.abs(seekPosition - 5.0)).toBeLessThanOrEqual(0.5);
	});

	it("returns 404 CHAPTER_NOT_FOUND when chapterId is out of range", async () => {
		const req = makePlayRequest({ recordingId: RECORDING_ID, chapterId: 99 });
		const res = await POST(req);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("CHAPTER_NOT_FOUND");
	});

	it("returns 404 CHAPTERS_NOT_GENERATED when no mapping exists", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue(null);
		const req = makePlayRequest({ recordingId: RECORDING_ID, chapterId: 0 });
		const res = await POST(req);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("CHAPTERS_NOT_GENERATED");
	});

	it("returns 200 without chapter fields when chapterId omitted (backward compatible)", async () => {
		const req = makePlayRequest({ recordingId: RECORDING_ID });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).not.toHaveProperty("chapterId");
	});
});
