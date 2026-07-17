// ---------------------------------------------------------------------------
// FFMetadata Vercel Blob Wrapper (Spec 009)
// Task: T013 — Read and upsert ffmetadata JSON documents in Vercel Blob.
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
import { head, put } from "@vercel/blob";
import { FFMetadataJSONSchema } from "./schemas";
import type { FFMetadataJSON } from "./types";

// ── Types ──────────────────────────────────────────────────────────────────

export type ReadResult =
	| { doc: FFMetadataJSON | null; corrupt: false }
	| { doc: null; corrupt: true };

export class BlobStorageError extends Error {
	constructor(message: string) {
		super(`BLOB_STORAGE_UNAVAILABLE: ${message}`);
		this.name = "BlobStorageError";
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BLOB_TIMEOUT_MS = 15_000;

/**
 * Race a promise against a timeout. For write operations (put), the caller
 * MUST use `withTimeoutForWrite` instead to avoid releasing the asset lock
 * while the underlying blob operation is still in-flight.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new BlobStorageError(`${label} timed out after ${ms}ms`)), ms),
		),
	]);
}

/**
 * Like `withTimeout` but for write operations: if the timeout fires first,
 * the error is deferred until the original write promise settles. This
 * prevents the asset lock from being released while a blob write is still
 * in-flight (which could cause a late write to overwrite a subsequent update).
 */
function withTimeoutForWrite<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timedOut = false;
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => {
			timedOut = true;
			reject(new BlobStorageError(`${label} timed out after ${ms}ms`));
		}, ms),
	);

	return Promise.race([promise, timeout]).catch((err) => {
		if (timedOut) {
			// Wait for the original write to settle before surfacing the timeout
			return promise.then(
				() => {
					throw err;
				},
				() => {
					throw err;
				},
			);
		}
		throw err;
	}) as Promise<T>;
}

function getToken(): string {
	const config = loadConfig();
	const token = config.BLOB_READ_WRITE_TOKEN;
	if (!token) {
		throw new BlobStorageError("BLOB_READ_WRITE_TOKEN is not configured");
	}
	return token;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Returns the deterministic blob path for a given asset id. */
export function getBlobPath(assetId: string): string {
	return `ffmetadata/${assetId}.json`;
}

/**
 * Read an ffmetadata JSON blob for the given asset id.
 *
 * @returns { doc, corrupt: false } when the blob exists and is valid.
 * @returns { doc: null, corrupt: false } when the blob does not exist.
 * @returns { doc: null, corrupt: true } when the blob exists but is corrupt (FR-023).
 * @throws BlobStorageError on read failure (network, auth, etc.).
 */
export async function readFFMetadata(assetId: string): Promise<ReadResult> {
	const token = getToken();
	const path = getBlobPath(assetId);

	let blobInfo: Awaited<ReturnType<typeof head>>;
	try {
		blobInfo = await withTimeout(head(path, { token }), BLOB_TIMEOUT_MS, "head");
	} catch (err) {
		// If blob not found, head returns null or throws a not-found error
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not_found") || msg.includes("not found") || msg.includes("404")) {
			return { doc: null, corrupt: false };
		}
		throw new BlobStorageError(`read failed: ${msg}`);
	}

	if (!blobInfo) {
		return { doc: null, corrupt: false };
	}

	// Fetch the blob content via authenticated downloadUrl (private blobs)
	let response: Response;
	try {
		response = await withTimeout(
			fetch(blobInfo.downloadUrl, { cache: "no-store" }),
			BLOB_TIMEOUT_MS,
			"fetch",
		);
	} catch (err) {
		throw new BlobStorageError(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (!response.ok) {
		throw new BlobStorageError(`fetch returned ${response.status}`);
	}

	const text = await response.text();
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		// Corrupt JSON → discard and start fresh (FR-023)
		return { doc: null, corrupt: true };
	}

	const parsed = FFMetadataJSONSchema.safeParse(json);
	if (!parsed.success) {
		// Schema-invalid → corrupt (FR-023)
		return { doc: null, corrupt: true };
	}

	return { doc: parsed.data, corrupt: false };
}

/**
 * Write (upsert) an ffmetadata JSON blob for the given asset id.
 *
 * @returns The blob URL.
 * @throws BlobStorageError on write failure.
 */
export async function writeFFMetadata(assetId: string, doc: FFMetadataJSON): Promise<string> {
	const token = getToken();
	const path = getBlobPath(assetId);

	try {
		const result = await withTimeoutForWrite(
			put(path, JSON.stringify(doc), {
				access: "private",
				contentType: "application/json",
				allowOverwrite: true,
				addRandomSuffix: false,
				token,
			}),
			BLOB_TIMEOUT_MS,
			"put",
		);
		return result.url;
	} catch (err) {
		throw new BlobStorageError(`write failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
