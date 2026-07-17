// ---------------------------------------------------------------------------
// Unit Tests: FFMetadata Blob Wrapper (Spec 009)
// Task: T007 — create-when-missing, overwrite-when-present, 503 on missing
//               token / write failure.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn().mockReturnValue({
		BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
	}),
}));

vi.mock("@vercel/blob", () => ({
	put: vi.fn(),
	head: vi.fn(),
	get: vi.fn(),
}));

describe("writeFFMetadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls put with correct parameters and returns the blob URL", async () => {
		const { put } = await import("@vercel/blob");
		vi.mocked(put).mockResolvedValue({
			url: "https://test.blob.vercel-storage.com/ffmetadata/rec_test.json",
		} as Awaited<ReturnType<typeof put>>);

		const { writeFFMetadata } = await import("@/lib/recording/ffmetadata-blob");
		const doc = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" as const },
			chapters: [{ id: 0, start: 0, end: 0, title: "Chapter 1" }],
		};

		const url = await writeFFMetadata("rec_test", doc);
		expect(url).toBe("https://test.blob.vercel-storage.com/ffmetadata/rec_test.json");
		expect(put).toHaveBeenCalledWith(
			"ffmetadata/rec_test.json",
			JSON.stringify(doc),
			expect.objectContaining({
				access: "private",
				contentType: "application/json",
				allowOverwrite: true,
				addRandomSuffix: false,
			}),
		);
	});

	it("throws BlobStorageError when put fails", async () => {
		const { put } = await import("@vercel/blob");
		vi.mocked(put).mockRejectedValue(new Error("network error"));

		const { writeFFMetadata, BlobStorageError } = await import("@/lib/recording/ffmetadata-blob");
		const doc = {
			metadata: { title: "rec_test", encoder: "aither-ffmetadata" as const },
			chapters: [{ id: 0, start: 0, end: 0, title: "Chapter 1" }],
		};

		await expect(writeFFMetadata("rec_test", doc)).rejects.toThrow(BlobStorageError);
	});
});

describe("readFFMetadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns { doc: null, corrupt: false } when blob not found", async () => {
		const { head } = await import("@vercel/blob");
		vi.mocked(head).mockRejectedValue(new Error("not_found"));

		const { readFFMetadata } = await import("@/lib/recording/ffmetadata-blob");
		const result = await readFFMetadata("rec_test");
		expect(result.doc).toBeNull();
		expect(result.corrupt).toBe(false);
	});

	it("returns { doc: null, corrupt: true } for invalid JSON", async () => {
		const { get, head } = await import("@vercel/blob");
		vi.mocked(head).mockResolvedValue({
			url: "https://test.blob.vercel-storage.com/ffmetadata/rec_test.json",
			downloadUrl: "https://test.blob.vercel-storage.com/ffmetadata/rec_test.json?download=1",
			etag: '"etag-1"',
		} as Awaited<ReturnType<typeof head>>);

		vi.mocked(get).mockResolvedValue({
			blob: {
				pathname: "ffmetadata/rec_test.json",
			} as never,
			headers: new Headers(),
			statusCode: 200,
			stream: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("{ invalid json"));
					controller.close();
				},
			}),
		} as Awaited<ReturnType<typeof get>>);

		const { readFFMetadata } = await import("@/lib/recording/ffmetadata-blob");
		const result = await readFFMetadata("rec_test");
		expect(result.doc).toBeNull();
		expect(result.corrupt).toBe(true);
	});

	it("reads private blobs via the blob sdk with cache bypass", async () => {
		const { get, head } = await import("@vercel/blob");
		vi.mocked(head).mockResolvedValue({
			url: "https://test.blob.vercel-storage.com/ffmetadata/rec_test.json",
			downloadUrl: "https://test.blob.vercel-storage.com/ffmetadata/rec_test.json?download=1",
			etag: '"etag-2"',
		} as Awaited<ReturnType<typeof head>>);

		vi.mocked(get).mockResolvedValue({
			blob: {
				pathname: "ffmetadata/rec_test.json",
			} as never,
			headers: new Headers(),
			statusCode: 200,
			stream: new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							JSON.stringify({
								metadata: { title: "rec_test", encoder: "aither-ffmetadata" },
								chapters: [{ id: 0, start: 0, end: 0, title: "Chapter 1" }],
							}),
						),
					);
					controller.close();
				},
			}),
		} as Awaited<ReturnType<typeof get>>);

		const { readFFMetadata } = await import("@/lib/recording/ffmetadata-blob");
		const result = await readFFMetadata("rec_test");

		expect(result.corrupt).toBe(false);
		expect(result.doc?.metadata.title).toBe("rec_test");
		expect(get).toHaveBeenCalledWith(
			"ffmetadata/rec_test.json",
			expect.objectContaining({
				access: "private",
				ifNoneMatch: '"etag-2"',
				useCache: false,
			}),
		);
	});
});
