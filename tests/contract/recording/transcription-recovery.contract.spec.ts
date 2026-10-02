// ---------------------------------------------------------------------------
// Contract Tests: Transcription Recovery
// Task: T036 [P] [US3] — Partial failure points (AssemblyAI submit/fetch/
// delete, MUX success/timeout, Blob failure, Hemera ready failure): stored
// references are reused and only incomplete stages are retried (FR-016).
// ---------------------------------------------------------------------------

import { runFullDeletionCleanup, runPostPublicationCleanup } from "@/lib/transcription/cleanup";
import { describe, expect, it } from "vitest";

function createProviders(overrides: Partial<Record<string, Error>> = {}) {
	return {
		deleteAssemblyAiTranscript: vi.fn(async () => {
			if (overrides.assemblyAi) throw overrides.assemblyAi;
		}),
		deleteBlobObject: vi.fn(async () => {
			if (overrides.blob) throw overrides.blob;
		}),
		deleteMuxAsset: vi.fn(async () => {
			if (overrides.mux) throw overrides.mux;
		}),
	};
}

import { vi } from "vitest";

const TARGETS = {
	assemblyAiTranscriptId: "tx-123",
	sourceBlobPathname: "seminar-sources/b1/r1.mp4",
	transcriptBlobPathname: "seminar-transcripts/b1/r1.txt",
	muxAssetId: "asset-xyz",
};

describe("post-publication cleanup (FR-013)", () => {
	it("completes both cleanup stages independently on success", async () => {
		const providers = createProviders();
		const outcome = await runPostPublicationCleanup(TARGETS, providers);

		expect(outcome.assemblyAiCleanupStatus).toBe("complete");
		expect(outcome.sourceBlobCleanupStatus).toBe("complete");
		expect(outcome.allConfirmed).toBe(true);
	});

	it("marks only the failed artifact retryable without affecting the other", async () => {
		const providers = createProviders({
			assemblyAi: new Error("503 unavailable"),
		});
		const outcome = await runPostPublicationCleanup(TARGETS, providers);

		expect(outcome.assemblyAiCleanupStatus).toBe("retryable_failure");
		expect(outcome.sourceBlobCleanupStatus).toBe("complete");
		expect(outcome.allConfirmed).toBe(false);
	});

	it("reports not_required for absent artifacts", async () => {
		const providers = createProviders();
		const outcome = await runPostPublicationCleanup(
			{ ...TARGETS, assemblyAiTranscriptId: null, sourceBlobPathname: null },
			providers,
		);

		expect(outcome.assemblyAiCleanupStatus).toBe("not_required");
		expect(outcome.sourceBlobCleanupStatus).toBe("not_required");
		expect(providers.deleteAssemblyAiTranscript).not.toHaveBeenCalled();
	});
});

describe("full deletion cleanup (FR-023)", () => {
	it("confirms only when every known artifact is deleted", async () => {
		const providers = createProviders();
		const outcome = await runFullDeletionCleanup(TARGETS, providers);

		expect(outcome.allConfirmed).toBe(true);
		expect(providers.deleteMuxAsset).toHaveBeenCalledWith("asset-xyz");
		expect(providers.deleteBlobObject).toHaveBeenCalledWith("seminar-transcripts/b1/r1.txt");
	});

	it("does not confirm when the MUX asset deletion fails", async () => {
		const providers = createProviders({ mux: new Error("409 conflict") });
		const outcome = await runFullDeletionCleanup(TARGETS, providers);

		expect(outcome.allConfirmed).toBe(false);
	});

	it("does not confirm when the final transcript Blob deletion fails", async () => {
		const providers = createProviders({ blob: new Error("network") });
		const outcome = await runFullDeletionCleanup(TARGETS, providers);

		expect(outcome.allConfirmed).toBe(false);
	});
});
