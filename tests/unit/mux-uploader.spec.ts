// ---------------------------------------------------------------------------
// Unit Tests: MUX Uploader
// Task: T033 [P] [US6] — Create direct upload, stream file, wait for asset
//                         ready, retrieve playback URL, handle MUX API errors,
//                         handle missing credentials
// ---------------------------------------------------------------------------

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config
const mockLoadConfig = vi.fn().mockReturnValue({
	MUX_TOKEN_ID: "test-token-id",
	MUX_TOKEN_SECRET: "test-token-secret",
});

vi.mock("@/lib/config", () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	stat: vi.fn().mockResolvedValue({ size: 1024000 }),
}));

vi.mock("node:fs", () => ({
	createReadStream: vi.fn().mockReturnValue({
		on: vi.fn(),
		pipe: vi.fn(),
	}),
}));

// Mock fetch for MUX upload PUT
const origFetch = globalThis.fetch;
const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

// Mock MUX SDK
const mockUploadsCreate = vi.fn().mockResolvedValue({
	id: "upload-123",
	url: "https://storage.googleapis.com/mux-uploads/upload-123",
	status: "waiting",
});

const mockUploadsRetrieve = vi.fn().mockResolvedValue({
	id: "upload-123",
	asset_id: "asset-456",
	status: "asset_created",
});

const mockAssetsRetrieve = vi.fn().mockResolvedValue({
	id: "asset-456",
	status: "ready",
	playback_ids: [{ id: "playback-789", policy: "public" }],
});

vi.mock("@mux/mux-node", () => ({
	default: vi.fn().mockImplementation(() => ({
		video: {
			uploads: {
				create: (...args: unknown[]) => mockUploadsCreate(...args),
				retrieve: (...args: unknown[]) => mockUploadsRetrieve(...args),
			},
			assets: {
				retrieve: (...args: unknown[]) => mockAssetsRetrieve(...args),
			},
		},
	})),
}));

describe("MUX Uploader", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		globalThis.fetch = mockFetch;
	});

	afterAll(() => {
		globalThis.fetch = origFetch;
	});

	it("throws MUX_NOT_CONFIGURED when credentials are missing", async () => {
		mockLoadConfig.mockReturnValueOnce({
			MUX_TOKEN_ID: undefined,
			MUX_TOKEN_SECRET: undefined,
		});

		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		await expect(uploadToMux("/tmp/test.mp4")).rejects.toThrow("MUX_NOT_CONFIGURED:");
	});

	it("uploads a file and returns asset ID and playback URL", async () => {
		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		const result = await uploadToMux("/tmp/test.mp4");

		expect(result.muxAssetId).toBe("asset-456");
		expect(result.muxPlaybackUrl).toContain("stream.mux.com");
		expect(result.muxPlaybackUrl).toContain("playback-789");
	});

	it("requests and waits for a static MP4 rendition when requested", async () => {
		mockAssetsRetrieve.mockResolvedValueOnce({
			id: "asset-456",
			status: "ready",
			static_renditions: {
				files: [{ name: "highest.mp4", status: "ready" }],
			},
		});

		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		const result = await uploadToMux("/tmp/test.mp4", { staticRendition: "highest" });

		expect(mockUploadsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				new_asset_settings: expect.objectContaining({
					static_renditions: [{ resolution: "highest" }],
				}),
			}),
		);
		expect(result.muxPlaybackUrl).toBe("https://stream.mux.com/playback-789/highest.mp4");
	});

	it("keeps polling while the requested static rendition is preparing", async () => {
		vi.useFakeTimers();
		mockAssetsRetrieve
			.mockResolvedValueOnce({
				id: "asset-456",
				status: "ready",
				static_renditions: {
					files: [{ name: "highest.mp4", status: "preparing" }],
				},
			})
			.mockResolvedValueOnce({
				id: "asset-456",
				status: "ready",
				static_renditions: {
					files: [{ name: "highest.mp4", status: "ready" }],
				},
			});

		try {
			const { uploadToMux } = await import("@/lib/recording/mux-uploader");
			const resultPromise = uploadToMux("/tmp/test.mp4", { staticRendition: "highest" });
			await vi.advanceTimersByTimeAsync(3000);
			const result = await resultPromise;

			expect(mockAssetsRetrieve).toHaveBeenCalledTimes(3);
			expect(result.muxPlaybackUrl).toBe("https://stream.mux.com/playback-789/highest.mp4");
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives the static rendition its own timeout after the asset is ready", async () => {
		vi.useFakeTimers();
		for (let poll = 0; poll < 99; poll++) {
			mockUploadsRetrieve.mockResolvedValueOnce({ id: "upload-123", status: "waiting" });
		}
		mockUploadsRetrieve.mockResolvedValueOnce({
			id: "upload-123",
			asset_id: "asset-456",
			status: "asset_created",
		});
		mockAssetsRetrieve
			.mockResolvedValueOnce({
				id: "asset-456",
				status: "ready",
				static_renditions: {
					files: [{ name: "highest.mp4", status: "preparing" }],
				},
			})
			.mockResolvedValueOnce({
				id: "asset-456",
				status: "ready",
				static_renditions: {
					files: [{ name: "highest.mp4", status: "ready" }],
				},
			});

		try {
			const { uploadToMux } = await import("@/lib/recording/mux-uploader");
			const resultPromise = uploadToMux("/tmp/test.mp4", { staticRendition: "highest" });
			await vi.advanceTimersByTimeAsync(300_000);
			const result = await resultPromise;

			expect(result.muxPlaybackUrl).toBe("https://stream.mux.com/playback-789/highest.mp4");
		} finally {
			vi.useRealTimers();
		}
	});

	it("throws MUX_UPLOAD_FAILED when upload creation fails", async () => {
		mockUploadsCreate.mockRejectedValueOnce(new Error("MUX API error"));

		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		await expect(uploadToMux("/tmp/test.mp4")).rejects.toThrow("MUX_UPLOAD_FAILED:");
	});

	it("throws MUX_UPLOAD_FAILED when file PUT fails", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		});

		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		await expect(uploadToMux("/tmp/test.mp4")).rejects.toThrow("MUX_UPLOAD_FAILED:");
	});

	it("throws MUX_UPLOAD_FAILED when upload is errored", async () => {
		mockUploadsRetrieve.mockResolvedValueOnce({
			id: "upload-123",
			status: "errored",
		});

		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		await expect(uploadToMux("/tmp/test.mp4")).rejects.toThrow("MUX_UPLOAD_FAILED:");
	});

	it("throws MUX_UPLOAD_FAILED when no playback ID on asset", async () => {
		// Called twice: once in pollForAsset (status check) and once in main function (playback ID)
		mockAssetsRetrieve
			.mockResolvedValueOnce({ id: "asset-456", status: "ready", playback_ids: [] })
			.mockResolvedValueOnce({ id: "asset-456", status: "ready", playback_ids: [] });

		const { uploadToMux } = await import("@/lib/recording/mux-uploader");
		await expect(uploadToMux("/tmp/test.mp4")).rejects.toThrow("MUX_UPLOAD_FAILED:");
	});
});
