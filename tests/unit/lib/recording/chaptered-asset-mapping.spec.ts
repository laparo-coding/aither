// ---------------------------------------------------------------------------
// Unit tests for chaptered-asset-mapping.ts (Spec 010)
// Covers: storeChapteredAssetMapping, getChapteredAssetMapping,
//         deleteChapteredAssetMapping, getBlobToken error path
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @vercel/blob
const mockPut = vi.fn();
const mockGet = vi.fn();
const mockDel = vi.fn();
vi.mock("@vercel/blob", () => ({
	put: (...args: unknown[]) => mockPut(...args),
	get: (...args: unknown[]) => mockGet(...args),
	del: (...args: unknown[]) => mockDel(...args),
}));

// Mock config to provide BLOB_READ_WRITE_TOKEN
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn(() => ({
		BLOB_READ_WRITE_TOKEN: "test-blob-token",
	})),
}));

const VALID_MAPPING = {
	assetId: "rec_2025-01-15T10-30-00Z",
	muxAssetId: "mux_asset_abc123",
	muxPlaybackUrl: "https://stream.mux.com/mux_asset_abc123.mp4",
	chapterCount: 5,
	generatedAt: "2025-01-15T10:35:00Z",
};

describe("chaptered-asset-mapping", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("storeChapteredAssetMapping", () => {
		it("stores mapping as JSON in blob with correct key", async () => {
			mockPut.mockResolvedValue({
				url: "https://blob.store/ffmetadata/rec_2025-01-15T10-30-00Z.chapters.json",
			});

			const { storeChapteredAssetMapping } = await import(
				"@/lib/recording/chaptered-asset-mapping"
			);
			await storeChapteredAssetMapping(VALID_MAPPING);

			expect(mockPut).toHaveBeenCalledOnce();
			const [key, body, options] = mockPut.mock.calls[0];
			expect(key).toBe("ffmetadata/rec_2025-01-15T10-30-00Z.chapters.json");
			expect(body).toBe(JSON.stringify(VALID_MAPPING));
			expect(options.access).toBe("private");
			expect(options.token).toBe("test-blob-token");
			expect(options.allowOverwrite).toBe(true);
			expect(options.addRandomSuffix).toBe(false);
		});

		it("throws when BLOB_READ_WRITE_TOKEN is not configured", async () => {
			const { loadConfig } = await import("@/lib/config");
			vi.mocked(loadConfig).mockReturnValueOnce({ BLOB_READ_WRITE_TOKEN: undefined } as never);

			const { storeChapteredAssetMapping } = await import(
				"@/lib/recording/chaptered-asset-mapping"
			);
			await expect(storeChapteredAssetMapping(VALID_MAPPING)).rejects.toThrow(
				"BLOB_READ_WRITE_TOKEN is not configured",
			);
		});
	});

	describe("getChapteredAssetMapping", () => {
		it("returns parsed mapping when blob exists", async () => {
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(JSON.stringify(VALID_MAPPING)));
					controller.close();
				},
			});
			mockGet.mockResolvedValue({ stream });

			const { getChapteredAssetMapping } = await import("@/lib/recording/chaptered-asset-mapping");
			const result = await getChapteredAssetMapping("rec_2025-01-15T10-30-00Z");

			expect(result).toEqual(VALID_MAPPING);
			expect(mockGet).toHaveBeenCalledOnce();
		});

		it("rethrows not_found errors from blob client", async () => {
			mockGet.mockRejectedValue(new Error("not_found"));

			const { getChapteredAssetMapping } = await import("@/lib/recording/chaptered-asset-mapping");
			await expect(getChapteredAssetMapping("nonexistent")).rejects.toThrow("not_found");
		});

		it("returns null when blob content is invalid JSON", async () => {
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("not-json"));
					controller.close();
				},
			});
			mockGet.mockResolvedValue({ stream });

			const { getChapteredAssetMapping } = await import("@/lib/recording/chaptered-asset-mapping");
			const result = await getChapteredAssetMapping("rec_2025-01-15T10-30-00Z");

			expect(result).toBeNull();
		});

		it("rethrows non-404 errors", async () => {
			mockGet.mockRejectedValue(new Error("Internal Server Error"));

			const { getChapteredAssetMapping } = await import("@/lib/recording/chaptered-asset-mapping");
			await expect(getChapteredAssetMapping("rec_2025-01-15T10-30-00Z")).rejects.toThrow(
				"Internal Server Error",
			);
		});
	});

	describe("deleteChapteredAssetMapping", () => {
		it("deletes blob with correct key and token", async () => {
			mockDel.mockResolvedValue(undefined);

			const { deleteChapteredAssetMapping } = await import(
				"@/lib/recording/chaptered-asset-mapping"
			);
			await deleteChapteredAssetMapping("rec_2025-01-15T10-30-00Z");

			expect(mockDel).toHaveBeenCalledOnce();
			const [key, options] = mockDel.mock.calls[0];
			expect(key).toBe("ffmetadata/rec_2025-01-15T10-30-00Z.chapters.json");
			expect(options.token).toBe("test-blob-token");
		});
	});
});
