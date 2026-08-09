// ---------------------------------------------------------------------------
// Chaptered MUX Asset Mapping (Spec 010)
// Stores the assetId → { muxAssetId, muxPlaybackUrl } mapping in Vercel Blob
// Storage at `ffmetadata/<assetId>.chapters.json` (same store as Spec 009,
// consistent with Constitution Principle VII — stateless, no local DB).
// ---------------------------------------------------------------------------

import { del, get, put } from "@vercel/blob";

import { loadConfig } from "@/lib/config";

export interface ChapteredAssetMapping {
	assetId: string;
	muxAssetId: string;
	muxPlaybackUrl: string;
	chapterCount: number;
	generatedAt: string;
}

function getMappingBlobKey(assetId: string): string {
	return `ffmetadata/${assetId}.chapters.json`;
}

function getBlobToken(): string {
	const config = loadConfig();
	const token = config.BLOB_READ_WRITE_TOKEN;
	if (!token) {
		throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
	}
	return token;
}

/**
 * Store the assetId → MUX chaptered asset mapping in Vercel Blob.
 * Overwrites any existing mapping (idempotent re-upload semantics, FR-010).
 */
export async function storeChapteredAssetMapping(mapping: ChapteredAssetMapping): Promise<void> {
	const token = getBlobToken();
	await put(getMappingBlobKey(mapping.assetId), JSON.stringify(mapping), {
		access: "private",
		token,
		addRandomSuffix: false,
		allowOverwrite: true,
	});
}

/**
 * Retrieve the MUX chaptered asset mapping for a given assetId.
 * @returns The mapping, or null if no chaptered asset has been generated yet.
 */
export async function getChapteredAssetMapping(
	assetId: string,
): Promise<ChapteredAssetMapping | null> {
	const token = getBlobToken();
	const blobResult = await get(getMappingBlobKey(assetId), {
		access: "private",
		token,
		useCache: false,
	});

	if (!blobResult) {
		return null;
	}

	const text = await new Response(blobResult.stream).text();
	try {
		return JSON.parse(text) as ChapteredAssetMapping;
	} catch {
		return null;
	}
}

/**
 * Delete the chaptered asset mapping (used on re-upload to clean up old entries).
 */
export async function deleteChapteredAssetMapping(assetId: string): Promise<void> {
	const token = getBlobToken();
	await del(getMappingBlobKey(assetId), { token });
}
