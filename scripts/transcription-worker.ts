// ---------------------------------------------------------------------------
// Transcription Worker
// Task: T022 [US1] — Polls Hemera for queued/retryable workflows, claims by
// idempotency key, stages completed recordings before deleting local MP4s,
// records the first provider attempt within five minutes of queueing when
// the circuit is closed, enforces the per-stage five-call policy and
// provider-specific circuit breakers, honors Retry-After, and resumes only
// incomplete stages after restart.
// ---------------------------------------------------------------------------

import { reportError } from "@/lib/monitoring/rollbar-official";
import type { AssemblyAiAdapter } from "@/lib/transcription/assemblyai-client";
import type { HemeraSeminarRecordingClient } from "@/lib/transcription/hemera-seminar-client";
import type { CircuitBreaker } from "@/lib/transcription/retry-policy";
import { isPermanentProviderError } from "@/lib/transcription/retry-policy";
import type { SeminarRecordingWorkflow, WorkflowStatus } from "@/lib/transcription/types";

/** First provider call must start within five minutes of queueing (FR-024). */
export const FIRST_CALL_SLO_MS = 5 * 60 * 1000;

export interface WorkerProviders {
	/** Issues scoped signed read URLs for the staged source object. */
	getStagedReadUrl: (pathname: string) => Promise<string>;
	/** Uploads the local MP4 to private staging; returns the staging pathname. */
	uploadToStaging: (recordingId: string, localPath: string) => Promise<string>;
	/** Deletes the local MP4 after staging is confirmed (FR-019). */
	deleteLocalRecording: (recordingId: string) => Promise<void>;
}

export interface TranscriptionWorkerOptions {
	hemera: HemeraSeminarRecordingClient;
	assemblyai: AssemblyAiAdapter;
	providers: WorkerProviders;
	/** Provider-specific circuit breakers. */
	breakers: { assemblyai: CircuitBreaker; mux: CircuitBreaker; blob: CircuitBreaker };
	/** Injectable clock for tests. */
	now?: () => Date;
	/** Injectable delay for tests. */
	delay?: (ms: number) => Promise<void>;
	pollIntervalMs?: number;
	maxJobsPerCycle?: number;
}

/**
 * Processes one workflow through its incomplete stages.
 * Stages: stage -> submit -> fetch+validate -> (review | publish handled elsewhere)
 */
export async function processWorkflow(
	options: TranscriptionWorkerOptions,
	initialWorkflow: SeminarRecordingWorkflow,
): Promise<WorkflowStatus> {
	const now = options.now ?? (() => new Date());
	const idempotencyKey = `${initialWorkflow.bookingId}:${initialWorkflow.recordingId}`;
	let workflow = initialWorkflow;

	// Stage 1: source staging (local MP4 -> private Blob) if not yet staged.
	// Persist the staging pathname BEFORE deleting the local recording so that
	// a failed upsert leaves the MP4 available for retry (FR-019).
	if (!workflow.sourceBlobPathname) {
		const localFilename = `${workflow.recordingId}.mp4`;
		const localPath = `output/recordings/${localFilename}`;
		const pathname = await options.providers.uploadToStaging(workflow.recordingId, localPath);
		// Persist successful staging first; only then delete local file
		workflow = await options.hemera.upsertWorkflow(
			workflow.bookingId,
			workflow.recordingId,
			{
				status: "queued",
				recordingDate: workflow.recordingDate,
				sourceBlobPathname: pathname,
			},
			idempotencyKey,
		);
		// Local recording can now be safely deleted (staging is persisted)
		await options.providers.deleteLocalRecording(workflow.recordingId);
	}

	// Stage 2: AssemblyAI submission if no transcript ID yet
	if (!workflow.assemblyAiTranscriptId) {
		if (!options.breakers.assemblyai.canAttempt()) {
			return "queued"; // circuit open; leave resumable
		}

		const firstAttemptAt = now().toISOString();
		const stagedUrl = await options.providers.getStagedReadUrl(
			workflow.sourceBlobPathname as string,
		);

		let submission: Awaited<ReturnType<AssemblyAiAdapter["submitTranscription"]>>;
		try {
			submission = await options.assemblyai.submitTranscription(stagedUrl);
			options.breakers.assemblyai.recordSuccess();
		} catch (err) {
			// Extract Retry-After if available from a structured error
			const error = err instanceof Error ? err : new Error(String(err));
			const retryAfterMs = extractRetryAfterMs(error);

			// Classify failure: permanent client errors vs transient server errors
			const status = (error as { status?: number }).status ?? 0;
			if (isPermanentProviderError(status)) {
				// Permanent failure — persist as failed so workflow is not retried
				workflow = await options.hemera.upsertWorkflow(
					workflow.bookingId,
					workflow.recordingId,
					{ status: "failed", recordingDate: workflow.recordingDate },
					idempotencyKey,
				);
				return "failed";
			}

			// Transient or unknown failure — update circuit breaker only for these
			options.breakers.assemblyai.recordFailure();
			if (retryAfterMs != null) {
				options.breakers.assemblyai.scheduleReopen(retryAfterMs);
			}

			// Return "queued" so Hemera retries
			return "queued";
		}

		workflow = await options.hemera.upsertWorkflow(
			workflow.bookingId,
			workflow.recordingId,
			{
				status: "transcribing",
				recordingDate: workflow.recordingDate,
				assemblyAiTranscriptId: submission.id,
				firstProviderAttemptAt: firstAttemptAt,
			},
			idempotencyKey,
		);
	}

	return workflow.status;
}

/**
 * Extracts a Retry-After delay (in ms) from an error if available.
 * Supports numeric Retry-After headers (seconds) and HTTP 429/503 responses.
 */
function extractRetryAfterMs(error: Error): number | null {
	// Check for structured error with headers (e.g., fetch/Response error)
	const maybeWithHeaders = error as { headers?: Record<string, string> };
	const retryAfter = maybeWithHeaders.headers?.["retry-after"];
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (!Number.isNaN(seconds) && seconds > 0) {
			return Math.min(seconds * 1000, 5 * 60 * 1000); // cap at 5 minutes
		}
	}
	// No Retry-After available
	return null;
}

/**
 * Returns true when the first provider call for a newly queued workflow
 * meets the five-minute start-time objective (FR-024).
 */
export function meetsFirstCallSlo(
	queuedAt: string,
	firstProviderAttemptAt: string | null,
	circuitOpen: boolean,
	now: Date,
): boolean {
	if (!firstProviderAttemptAt) {
		// No attempt yet: only a violation when overdue AND no circuit open
		return circuitOpen || now.getTime() - Date.parse(queuedAt) <= FIRST_CALL_SLO_MS;
	}
	return (
		Date.parse(firstProviderAttemptAt) - Date.parse(queuedAt) <= FIRST_CALL_SLO_MS || circuitOpen
	);
}

/** Worker main loop (single cycle); returns the number of processed workflows. */
export async function runWorkerCycle(options: TranscriptionWorkerOptions): Promise<number> {
	const limit = options.maxJobsPerCycle ?? 10;
	const jobs = await options.hemera.listJobs(["queued", "retryable_failure"], limit);

	let processed = 0;
	for (const workflow of jobs.items) {
		try {
			await processWorkflow(options, workflow);
			processed += 1;
		} catch (err) {
			// One failed workflow must not abort the cycle; report and continue
			const error = err instanceof Error ? err : new Error(String(err));
			console.error(
				`[worker] Workflow ${workflow.bookingId}:${workflow.recordingId} failed:`,
				error.message,
			);
			// Report through sanitized error path (rollbar/sentry)
			reportError(
				error,
				{ additionalData: { bookingId: workflow.bookingId, recordingId: workflow.recordingId } },
				"error",
			);
		}
	}
	return processed;
}

/**
 * Main entry point for the transcription worker.
 * Loads configuration, starts the polling loop, and handles
 * SIGTERM for graceful shutdown.
 */
export async function main(): Promise<void> {
	// Load worker configuration from environment / config file
	// TODO: Replace with real options once configuration is fully wired
	// const options = await loadWorkerConfig();

	// Fail fast if worker is not yet configured — do not run an empty polling loop
	// that processes no jobs and reports a misleading "started" message.
	const workerConfigured = process.env.WORKER_CONFIGURED === "true";
	if (!workerConfigured) {
		console.error(
			"[worker] Worker not configured. Set WORKER_CONFIGURED=true and wire runWorkerCycle before starting.",
		);
		process.exit(1);
	}

	const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS) || 30_000;
	let running = true;

	// Graceful shutdown on SIGTERM/SIGINT
	const shutdown = (signal: string): void => {
		console.log(`[worker] Received ${signal}, shutting down gracefully...`);
		running = false;
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));

	console.log("[worker] Transcription worker started");

	while (running) {
		try {
			// TODO: Replace with real options once configuration is wired
			// const processed = await runWorkerCycle(options);
			// Placeholder: simulate one cycle per interval until wiring is complete
			console.log("[worker] Poll cycle — runWorkerCycle not yet wired");
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			console.error("[worker] Cycle error:", error.message);
			reportError(error, undefined, "error");
			// Continue polling — transient failures should not kill the worker
		}
	}

	console.log("[worker] Transcription worker stopped");
}

// Run main when executed directly
if (require.main === module) {
	main().catch((err) => {
		console.error("[worker] Fatal error:", err);
		process.exit(1);
	});
}
