// ---------------------------------------------------------------------------
// Contract Tests: Playback API
// Task: T023 [P] [US3] — POST play/stop/rewind/forward return 200 with state,
//                         404 when no player connected, 404 when recording not
//                         found, POST state accepts player reports
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));
vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({
		status: 200,
		body: { sessionClaims: { metadata: { role: "admin" } } },
	}),
}));

// Mock config
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		RECORDINGS_OUTPUT_DIR: "output/recordings",
	}),
}));

// Mock monitoring
vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

// Playback controller mocks
const mockDispatchCommand = vi.fn();
const mockUpdatePlayerState = vi.fn();
const mockGetPlaybackState = vi.fn();
const mockHasConnectedClients = vi.fn();
const mockCalculateSeekPosition = vi.fn();

vi.mock("@/lib/recording/playback-controller", () => ({
	dispatchCommand: (...args: unknown[]) => mockDispatchCommand(...args),
	updatePlayerState: (...args: unknown[]) => mockUpdatePlayerState(...args),
	getPlaybackState: (...args: unknown[]) => mockGetPlaybackState(...args),
	hasConnectedClients: (...args: unknown[]) => mockHasConnectedClients(...args),
	calculateSeekPosition: (...args: unknown[]) => mockCalculateSeekPosition(...args),
	registerClient: vi.fn(),
	unregisterClient: vi.fn(),
	closeClientsForRecording: vi.fn(),
	_resetState: vi.fn(),
}));

// File manager mock (for recording existence checks)
vi.mock("@/lib/recording/file-manager", () => ({
	getRecordingById: vi.fn().mockResolvedValue({
		id: "rec_2025-01-15T10-30-00Z",
		filename: "rec_2025-01-15T10-30-00Z.mp4",
		duration: 300,
		fileSize: 1024000,
		createdAt: "2025-01-15T10:30:00Z",
		filePath: "output/recordings/rec_2025-01-15T10-30-00Z.mp4",
	}),
	resolveFilePath: vi.fn().mockResolvedValue("output/recordings/rec_2025-01-15T10-30-00Z.mp4"),
}));

function createRequest(url: string, method = "POST", body?: unknown): NextRequest {
	const init: { method: string; headers: Record<string, string>; body?: string } = {
		method,
		headers: { "Content-Type": "application/json" },
	};
	if (body) init.body = JSON.stringify(body);
	// biome-ignore lint: type coercion needed for NextRequest constructor
	return new NextRequest(new URL(url), init as any);
}

// ── Play ──────────────────────────────────────────────────────────────────

describe("POST /api/recording/playback/play", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDispatchCommand.mockReturnValue({ status: "playing", position: 0 });
		mockHasConnectedClients.mockReturnValue(true);
	});

	it("returns 200 with accepted state", async () => {
		const { POST } = await import("@/app/api/recording/playback/play/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/play", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("accepted", true);
	});

	it("returns 404 when no player is connected", async () => {
		mockDispatchCommand.mockReturnValue(null);

		const { POST } = await import("@/app/api/recording/playback/play/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/play", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
		});
		const res = await POST(req);

		expect(res.status).toBe(404);
	});
});

// ── Stop ──────────────────────────────────────────────────────────────────

describe("POST /api/recording/playback/stop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDispatchCommand.mockReturnValue({ status: "paused", position: 45 });
	});

	it("returns 200 with paused state", async () => {
		const { POST } = await import("@/app/api/recording/playback/stop/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/stop", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.data).toHaveProperty("status", "paused");
	});

	it("returns 404 when no player is connected", async () => {
		mockDispatchCommand.mockReturnValue(null);

		const { POST } = await import("@/app/api/recording/playback/stop/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/stop", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
		});
		const res = await POST(req);

		expect(res.status).toBe(404);
	});
});

// ── Rewind ────────────────────────────────────────────────────────────────

describe("POST /api/recording/playback/rewind", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaybackState.mockReturnValue({ position: 60 });
		mockCalculateSeekPosition.mockReturnValue(50);
		mockDispatchCommand.mockReturnValue({ status: "playing", position: 50 });
	});

	it("returns 200 with updated position", async () => {
		const { POST } = await import("@/app/api/recording/playback/rewind/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/rewind", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
			seconds: 10,
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
	});

	it("returns 404 when no player is connected", async () => {
		mockGetPlaybackState.mockReturnValue(null);

		const { POST } = await import("@/app/api/recording/playback/rewind/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/rewind", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
			seconds: 10,
		});
		const res = await POST(req);

		expect(res.status).toBe(404);
	});
});

// ── Forward ───────────────────────────────────────────────────────────────

describe("POST /api/recording/playback/forward", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaybackState.mockReturnValue({ position: 30 });
		mockCalculateSeekPosition.mockReturnValue(40);
		mockDispatchCommand.mockReturnValue({ status: "playing", position: 40 });
	});

	it("returns 200 with updated position", async () => {
		const { POST } = await import("@/app/api/recording/playback/forward/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/forward", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
			seconds: 10,
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
	});

	it("returns 404 when no player is connected", async () => {
		mockGetPlaybackState.mockReturnValue(null);

		const { POST } = await import("@/app/api/recording/playback/forward/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/forward", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
			seconds: 10,
		});
		const res = await POST(req);

		expect(res.status).toBe(404);
	});
});

// ── State Report ──────────────────────────────────────────────────────────

describe("POST /api/recording/playback/state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdatePlayerState.mockReturnValue(true);
	});

	it("returns 200 when player state is accepted", async () => {
		const { POST } = await import("@/app/api/recording/playback/state/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/state", "POST", {
			recordingId: "rec_2025-01-15T10-30-00Z",
			state: "playing",
			position: 42,
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
	});

	it("returns 404 when recording has no playback state", async () => {
		mockUpdatePlayerState.mockReturnValue(false);

		const { POST } = await import("@/app/api/recording/playback/state/route");
		const req = createRequest("http://localhost:3000/api/recording/playback/state", "POST", {
			recordingId: "rec_nonexistent",
			state: "playing",
			position: 0,
		});
		const res = await POST(req);

		expect(res.status).toBe(404);
	});
});
