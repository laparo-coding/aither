// ---------------------------------------------------------------------------
// Contract Tests: POST /api/recording/playback/play with startAtFirst (Spec 011)
// Task: T030–T032a — Server-side initial seek consistency for non-web-player
//                      clients. When startAtFirst: true + no chapterId + chapters
//                      exist → seek to chapters[0].start then play, return
//                      { accepted, chapterId: 0, start, end }.
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

const mockGetChapteredAssetMapping = vi.fn();

vi.mock("@/lib/recording/chaptered-asset-mapping", () => ({
	getChapteredAssetMapping: (...args: unknown[]) => mockGetChapteredAssetMapping(...args),
}));

const mockExtractChapters = vi.fn();

vi.mock("@/lib/recording/chapter-extractor", () => ({
	extractChapters: (...args: unknown[]) => mockExtractChapters(...args),
}));

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

import { POST } from "@/app/api/recording/playback/play/route";

beforeEach(() => {
	mockGetChapteredAssetMapping.mockResolvedValue(VALID_MAPPING);
	mockExtractChapters.mockResolvedValue(VALID_CHAPTER_LIST);
	mockDispatchCommand.mockReturnValue(true);
});

describe("POST /api/recording/playback/play with startAtFirst (T030–T032a)", () => {
	it("T030: startAtFirst: true + chaptered recording → 200 with chapterId 0, start, end; dispatches seek then play", async () => {
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID, startAtFirst: true });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).toHaveProperty("chapterId", 0);
		expect(data).toHaveProperty("start", 5.0);
		expect(data).toHaveProperty("end", 20.0);

		// Assert dispatchCommand call order: seek then play
		expect(mockDispatchCommand).toHaveBeenCalledTimes(2);
		const firstCall = mockDispatchCommand.mock.calls[0][1] as { action: string; position?: number };
		const secondCall = mockDispatchCommand.mock.calls[1][1] as { action: string };
		expect(firstCall.action).toBe("seek");
		expect(firstCall.position).toBe(5.0);
		expect(secondCall.action).toBe("play");
	});

	it("T031: startAtFirst: true + non-chaptered recording → 200 with { accepted: true } (backward compatible)", async () => {
		mockGetChapteredAssetMapping.mockResolvedValue(null);
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID, startAtFirst: true });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).not.toHaveProperty("chapterId");

		// Only play dispatched (no seek)
		expect(mockDispatchCommand).toHaveBeenCalledTimes(1);
		const call = mockDispatchCommand.mock.calls[0][1] as { action: string };
		expect(call.action).toBe("play");
	});

	it("T032: startAtFirst omitted + chaptered recording → 200 with { accepted: true } (Spec 004 resume, no seek)", async () => {
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).not.toHaveProperty("chapterId");

		// Only play dispatched (no seek), even though chapters exist
		expect(mockDispatchCommand).toHaveBeenCalledTimes(1);
		const call = mockDispatchCommand.mock.calls[0][1] as { action: string };
		expect(call.action).toBe("play");
	});

	it("T032: startAtFirst: false + chaptered recording → 200 with { accepted: true } (Spec 004 resume, no seek)", async () => {
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID, startAtFirst: false });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).not.toHaveProperty("chapterId");
		expect(mockDispatchCommand).toHaveBeenCalledTimes(1);
	});

	it("T032a: explicit chapterId + startAtFirst: true → Spec 010 behavior preserved (startAtFirst ignored)", async () => {
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID, chapterId: 1, startAtFirst: true });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).toHaveProperty("chapterId", 1);
		expect(data).toHaveProperty("start", 20.0);
		expect(data).toHaveProperty("end", 45.0);

		// Seek to chapter 1 start (20.0), not chapter 0 start (5.0)
		const seekCall = mockDispatchCommand.mock.calls.find(
			(c) => (c[1] as { action: string }).action === "seek",
		);
		expect(seekCall).toBeDefined();
		expect((seekCall?.[1] as { position: number }).position).toBe(20.0);
	});

	it("startAtFirst: true + extractChapters throws → falls back to play only (backward compatible)", async () => {
		mockExtractChapters.mockRejectedValue(new Error("ffprobe failed"));
		mockDispatchCommand.mockClear();
		const req = makePlayRequest({ recordingId: RECORDING_ID, startAtFirst: true });
		const res = await POST(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		const data = body.data ?? body;
		expect(data).toHaveProperty("accepted", true);
		expect(data).not.toHaveProperty("chapterId");
		expect(mockDispatchCommand).toHaveBeenCalledTimes(1);
		const call = mockDispatchCommand.mock.calls[0][1] as { action: string };
		expect(call.action).toBe("play");
	});
});
