// ---------------------------------------------------------------------------
// Content Hash Computation & Manifest Management
// Task: T024 [US1] — SHA-256, sorted keys, atomic read/write
// ---------------------------------------------------------------------------

import { createHash, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SyncManifest } from "./types";

/**
 * Compute a SHA-256 hash of the combined template + data content.
 * Keys are sorted for deterministic output regardless of insertion order.
 */
export function computeContentHash(templateContent: string, data: Record<string, unknown>): string {
	const normalized = JSON.stringify({ template: templateContent, data }, (_key, value) => {
		// Sort object keys for determinism
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			return Object.keys(value)
				.sort()
				.reduce(
					(sorted, key) => {
						sorted[key] = (value as Record<string, unknown>)[key];
						return sorted;
					},
					{} as Record<string, unknown>,
				);
		}
		return value;
	});

	return createHash("sha256").update(normalized, "utf-8").digest("hex");
}

export interface ManifestDiff {
	/** Entity keys that are new or have a different hash */
	changed: string[];
	/** Entity keys present in the old manifest but absent from new hashes */
	deleted: string[];
	/** Entity keys with identical hash */
	unchanged: string[];
}

/**
 * Compare a previous manifest with new content hashes to find changes.
 */
export function diffManifest(
	oldManifest: SyncManifest,
	newHashes: Record<string, string>,
): ManifestDiff {
	const changed: string[] = [];
	const unchanged: string[] = [];
	const deleted: string[] = [];

	// Check new hashes against old using constant-time comparison to avoid timing attacks
	for (const [key, hash] of Object.entries(newHashes)) {
		const oldHash = oldManifest.hashes[key];
		if (oldHash !== undefined && oldHash.length === hash.length) {
			const oldBuf = Buffer.from(oldHash, "utf8");
			const newBuf = Buffer.from(hash, "utf8");
			if (timingSafeEqual(oldBuf, newBuf)) {
				unchanged.push(key);
			} else {
				changed.push(key);
			}
		} else {
			changed.push(key);
		}
	}

	// Check for deletions (in old but not in new)
	for (const key of Object.keys(oldManifest.hashes)) {
		if (!(key in newHashes)) {
			deleted.push(key);
		}
	}

	return { changed, deleted, unchanged };
}

/**
 * Read the sync manifest from the filesystem.
 * Returns an empty manifest if the file doesn't exist.
 */
export async function readManifest(manifestPath: string): Promise<SyncManifest> {
	try {
		const content = await fs.readFile(manifestPath, "utf-8");
		return JSON.parse(content) as SyncManifest;
	} catch {
		return { lastSyncTime: "", hashes: {} };
	}
}

/**
 * Write the sync manifest atomically (tmp + rename).
 */
export async function writeManifest(manifestPath: string, manifest: SyncManifest): Promise<void> {
	const dir = path.dirname(manifestPath);
	await fs.mkdir(dir, { recursive: true });

	const tmpPath = `${manifestPath}.tmp`;
	await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
	await fs.rename(tmpPath, manifestPath);
}
