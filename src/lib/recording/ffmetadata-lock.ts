// ---------------------------------------------------------------------------
// FFMetadata Per-Asset-ID Async Mutex (Spec 009)
// Task: T014 — In-process serialization to prevent lost updates.
//               Lock wraps only the blob read-modify-write section (FR-025).
//               Released on settle via try/finally.
//               ETag-based conditional writes with retry for cross-instance safety.
// ---------------------------------------------------------------------------

import { BlobStorageError } from "./ffmetadata-blob";

// ── In-memory lock map ────────────────────────────────────────────────────

const locks = new Map<string, Promise<unknown>>();

/** Maximum retries for ETag precondition failures (concurrent overwrites). */
const ETAG_RETRY_MAX = 3;

/**
 * Execute a function within a per-asset-id mutex.
 *
 * Concurrent calls for the same assetId are serialized: each call waits for
 * the previous one to settle (resolve or reject) before executing. Different
 * asset ids proceed in parallel.
 *
 * The lock is released on settle via try/finally (FR-025). No explicit timeout
 * is applied; the implementation relies on Vercel Blob's network timeout.
 *
 * @param assetId - The asset id to lock on.
 * @param fn - The async function to execute inside the lock.
 * @returns The result of `fn`.
 */
export async function withAssetLock<T>(assetId: string, fn: () => Promise<T>): Promise<T> {
	// Get the current lock chain (or undefined if no lock exists)
	const previous = locks.get(assetId);

	// Create a new promise that chains after the previous one
	const next = (previous ?? Promise.resolve())
		.catch(() => {}) // Swallow errors from previous lock holders
		.then(async () => {
			try {
				return await fn();
			} finally {
				// Only delete if we're still the latest lock
				if (locks.get(assetId) === next) {
					locks.delete(assetId);
				}
			}
		});

	locks.set(assetId, next);

	return next as Promise<T>;
}

/**
 * Execute a read-modify-write cycle with ETag-based conditional writes.
 * On BlobPreconditionFailedError (concurrent overwrite), retries up to
 * ETAG_RETRY_MAX times by re-reading and re-applying the modifier.
 *
 * @param assetId - The asset id to operate on.
 * @param readFn - Async function that reads the current state and returns the ETag.
 * @param writeFn - Async function that writes with the given ETag as ifMatch.
 * @param modifyFn - Function that transforms the read state into the write state.
 */
export async function withETagRetry<TRead, TWrite>(
	readFn: () => Promise<{ data: TRead; etag: string | null }>,
	writeFn: (data: TWrite, etag: string | null) => Promise<string>,
	modifyFn: (data: TRead) => TWrite,
): Promise<string> {
	for (let attempt = 0; attempt <= ETAG_RETRY_MAX; attempt++) {
		const { data, etag } = await readFn();
		const modified = modifyFn(data);
		try {
			return await writeFn(modified, etag);
		} catch (err) {
			if (
				err instanceof BlobStorageError &&
				(err.message.includes("precondition") ||
					err.message.includes("ETag") ||
					err.message.includes("412"))
			) {
				if (attempt < ETAG_RETRY_MAX) {
					continue; // Retry with fresh read
				}
			}
			throw err;
		}
	}
	throw new BlobStorageError("ETag retry exhausted");
}

// ── Test Helpers ───────────────────────────────────────────────────────────

/** Visible for testing — returns the number of active locks. */
export function _getLockCount(): number {
	return locks.size;
}

/** Reset all locks for test isolation. */
export function _resetLocks(): void {
	locks.clear();
}
