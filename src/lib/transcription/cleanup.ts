// ---------------------------------------------------------------------------
// Provider Cleanup
// Task: T039 [US3] — Separate AssemblyAI transcript and source-staging
// cleanup with independent retry tracking. Cleanup runs only after Hemera
// `ready`; a cleanup failure never reruns transcription or hides published
// documents (FR-013). Booking deletion also removes both Blob objects.
// ---------------------------------------------------------------------------

import type { CleanupStatus } from "./types";

export interface CleanupTargets {
	assemblyAiTranscriptId: string | null;
	sourceBlobPathname: string | null;
	transcriptBlobPathname: string | null;
	muxAssetId: string | null;
}

export interface CleanupProviders {
	deleteAssemblyAiTranscript: (transcriptId: string) => Promise<void>;
	deleteBlobObject: (pathname: string) => Promise<void>;
	deleteMuxAsset: (assetId: string) => Promise<void>;
}

export interface CleanupOutcome {
	assemblyAiCleanupStatus: CleanupStatus;
	sourceBlobCleanupStatus: CleanupStatus;
	/** True only when every known artifact is deleted or confirmed already deleted. */
	allConfirmed: boolean;
}

/**
 * Runs post-publication cleanup (AssemblyAI transcript + source staging).
 * Each artifact is deleted independently; a failure marks that artifact
 * `retryable_failure` without affecting the others or published documents.
 */
export async function runPostPublicationCleanup(
	targets: CleanupTargets,
	providers: CleanupProviders,
): Promise<CleanupOutcome> {
	let assemblyAiCleanupStatus: CleanupStatus = "not_required";
	let sourceBlobCleanupStatus: CleanupStatus = "not_required";

	if (targets.assemblyAiTranscriptId) {
		try {
			await providers.deleteAssemblyAiTranscript(targets.assemblyAiTranscriptId);
			assemblyAiCleanupStatus = "complete";
		} catch {
			assemblyAiCleanupStatus = "retryable_failure";
		}
	}

	if (targets.sourceBlobPathname) {
		try {
			await providers.deleteBlobObject(targets.sourceBlobPathname);
			sourceBlobCleanupStatus = "complete";
		} catch {
			sourceBlobCleanupStatus = "retryable_failure";
		}
	}

	return {
		assemblyAiCleanupStatus,
		sourceBlobCleanupStatus,
		allConfirmed:
			assemblyAiCleanupStatus !== "retryable_failure" &&
			sourceBlobCleanupStatus !== "retryable_failure",
	};
}

/**
 * Runs full deletion cleanup after booking/participation deletion or admin
 * abandonment: every known artifact must be deleted or idempotently
 * confirmed already deleted before Hemera purges the tombstone (FR-023).
 */
export async function runFullDeletionCleanup(
	targets: CleanupTargets,
	providers: CleanupProviders,
): Promise<CleanupOutcome> {
	const post = await runPostPublicationCleanup(targets, providers);

	let allConfirmed = post.allConfirmed;

	if (targets.transcriptBlobPathname) {
		try {
			await providers.deleteBlobObject(targets.transcriptBlobPathname);
		} catch {
			allConfirmed = false;
		}
	}

	if (targets.muxAssetId) {
		try {
			await providers.deleteMuxAsset(targets.muxAssetId);
		} catch {
			allConfirmed = false;
		}
	}

	return { ...post, allConfirmed };
}
