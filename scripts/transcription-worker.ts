// ---------------------------------------------------------------------------
// Transcription Worker
// Polls canonical Hemera workflow state and resumes incomplete provider stages.
// ---------------------------------------------------------------------------

import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "@/lib/config";
import { reportError } from "@/lib/monitoring/rollbar-official";
import { ingestStagedSourceToMux } from "@/lib/recording/mux-uploader";
import {
	buildTranscriptPathname,
	createStagedReadUrl,
	deletePrivateBlob,
	uploadRecordingToStaging,
	uploadTranscriptToPrivateBlob,
} from "@/lib/recording/source-staging";
import {
	AssemblyAiAdapter,
	type AssemblyAiTranscript,
} from "@/lib/transcription/assemblyai-client";
import { createHemeraSeminarRecordingClient } from "@/lib/transcription/hemera-seminar-client";
import {
	CircuitBreaker,
	computeBackoffDelay,
	isPermanentProviderError,
	shouldRetryStage,
} from "@/lib/transcription/retry-policy";
import { validateOperatorMapping, validateRoleMapping } from "@/lib/transcription/role-mapping";
import type { SeminarRecordingWorkflow, WorkflowStatus } from "@/lib/transcription/types";

/** First provider call must start within five minutes of queueing (FR-024). */
export const FIRST_CALL_SLO_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MAX_JOBS_PER_CYCLE = 10;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;
const ROLES = ["Seminarleiter", "Teilnehmerin"] as const;

export interface WorkerProviders {
	getStagedReadUrl: (pathname: string) => Promise<string>;
	uploadToStaging: (bookingId: string, recordingId: string, localPath: string) => Promise<string>;
	deleteLocalRecording: (recordingId: string) => Promise<void>;
	ingestToMux: (
		sourceUrl: string,
		idempotencyKey: string,
	) => Promise<{
		muxAssetId: string;
		muxPlaybackId: string;
		muxPlaybackUrl: string;
		durationSeconds: number;
	}>;
	storeTranscript: (pathname: string, content: string) => Promise<void>;
}

export interface TranscriptionWorkerOptions {
	hemera: ReturnType<typeof createHemeraSeminarRecordingClient>;
	assemblyai: AssemblyAiAdapter;
	providers: WorkerProviders;
	breakers: { assemblyai: CircuitBreaker; mux: CircuitBreaker; blob: CircuitBreaker };
	now?: () => Date;
	delay?: (ms: number) => Promise<void>;
	pollIntervalMs?: number;
	maxJobsPerCycle?: number;
}

function getAttemptCount(workflow: SeminarRecordingWorkflow, stage: string): number {
	return workflow.stageAttemptCounts?.[stage] ?? 0;
}

function stageIdempotencyKey(workflow: SeminarRecordingWorkflow, stage: string): string {
	return `${workflow.bookingId}:${workflow.recordingId}:${stage}`;
}

async function persist(
	options: TranscriptionWorkerOptions,
	workflow: SeminarRecordingWorkflow,
	update: Parameters<typeof options.hemera.upsertWorkflow>[2],
	stage: string,
): Promise<SeminarRecordingWorkflow> {
	return options.hemera.upsertWorkflow(
		workflow.bookingId,
		workflow.recordingId,
		update,
		stageIdempotencyKey(workflow, stage),
	);
}

function errorStatus(error: unknown): number {
	return typeof error === "object" && error !== null && "status" in error
		? Number((error as { status: unknown }).status) || 0
		: 0;
}

function extractRetryAfterMs(error: unknown, now: Date): number | undefined {
	if (typeof error !== "object" || error === null || !("headers" in error)) return undefined;
	const headers = (error as { headers?: Record<string, string> }).headers;
	const value = headers?.["retry-after"];
	if (!value) return undefined;
	const seconds = Number(value);
	const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now.getTime();
	return delay > 0 ? Math.min(delay, MAX_RETRY_AFTER_MS) : undefined;
}

async function runStage<T>(
	options: TranscriptionWorkerOptions,
	initialWorkflow: SeminarRecordingWorkflow,
	stage: string,
	breaker: CircuitBreaker,
	action: () => Promise<T>,
): Promise<{ workflow: SeminarRecordingWorkflow; result?: T }> {
	let workflow = initialWorkflow;
	const now = (options.now ?? (() => new Date()))();
	const attemptsMade = getAttemptCount(workflow, stage);
	if (!shouldRetryStage(attemptsMade)) {
		const failed = await persist(
			options,
			workflow,
			{
				status: "failed",
				recordingDate: workflow.recordingDate,
				lastErrorCode: `${stage}_attempt_limit`,
				nextAttemptAt: null,
			},
			`${stage}:attempt-limit`,
		);
		return { workflow: failed };
	}
	if (!breaker.canAttempt()) return { workflow };

	const attempt = attemptsMade + 1;
	try {
		workflow = await persist(
			options,
			workflow,
			{
				status: workflow.status,
				recordingDate: workflow.recordingDate,
				stageAttemptCounts: { ...workflow.stageAttemptCounts, [stage]: attempt },
				nextAttemptAt: null,
				...(stage === "assemblyai_submit" && !workflow.firstProviderAttemptAt
					? { firstProviderAttemptAt: now.toISOString() }
					: {}),
			},
			`${stage}:attempt:${attempt}`,
		);
	} catch (error) {
		breaker.recordNonTransientFailure();
		throw error;
	}

	try {
		const result = await action();
		breaker.recordSuccess();
		return { workflow, result };
	} catch (error) {
		const status = errorStatus(error);
		if (isPermanentProviderError(status)) {
			breaker.recordNonTransientFailure();
			const failed = await persist(
				options,
				workflow,
				{
					status: "failed",
					recordingDate: workflow.recordingDate,
					lastErrorCode: `${stage}_provider_${status}`,
					nextAttemptAt: null,
				},
				`${stage}:permanent-failure`,
			);
			return { workflow: failed };
		}

		breaker.recordFailure();
		const retry = shouldRetryStage(attempt);
		const retryAfterMs = extractRetryAfterMs(error, now);
		const delayMs = computeBackoffDelay(attempt, 1_000, retryAfterMs);
		const nextAttemptAt = retry ? new Date(now.getTime() + delayMs).toISOString() : null;
		const failed = await persist(
			options,
			workflow,
			{
				status: retry ? "retryable_failure" : "failed",
				recordingDate: workflow.recordingDate,
				lastErrorCode: `${stage}_transient_failure`,
				nextAttemptAt,
			},
			`${stage}:failure:${attempt}`,
		);
		return { workflow: failed };
	}
}

function invertSpeakerIdentification(
	transcript: AssemblyAiTranscript,
): Record<string, string> | null {
	const identification = transcript.speech_understanding?.response?.speaker_identification;
	if (!identification?.mapping) return null;
	const roleToSpeaker: Record<string, string> = {};
	for (const [speakerId, role] of Object.entries(identification.mapping)) {
		if (ROLES.includes(role as (typeof ROLES)[number])) roleToSpeaker[role] = speakerId;
	}
	return roleToSpeaker;
}

function transcriptUtterances(transcript: AssemblyAiTranscript) {
	return (transcript.utterances ?? []).map((utterance) => ({
		speakerId: utterance.speaker || null,
		text: utterance.text,
		startMs: utterance.start,
		endMs: utterance.end,
	}));
}

export function formatRoleSeparatedTranscript(
	transcript: AssemblyAiTranscript,
	roleToSpeaker: Record<string, string>,
): string {
	const speakerToRole = new Map(
		Object.entries(roleToSpeaker).map(([role, speaker]) => [speaker, role]),
	);
	return [...(transcript.utterances ?? [])]
		.sort((left, right) => left.start - right.start)
		.map((utterance) => {
			const role = speakerToRole.get(utterance.speaker);
			if (!role) throw new Error("TRANSCRIPT_INVALID: utterance speaker has no approved role");
			return `${role}: ${utterance.text.trim()}`;
		})
		.join("\n");
}

function operatorMapping(workflow: SeminarRecordingWorkflow): Record<string, string> | null {
	if (!workflow.reviewedSpeakerMapping) return null;
	const mapping: Record<string, string> = {};
	for (const [speakerId, role] of Object.entries(workflow.reviewedSpeakerMapping)) {
		if (ROLES.includes(role as (typeof ROLES)[number])) mapping[role] = speakerId;
	}
	return mapping;
}

/**
 * Resumes the first incomplete durable stage for a workflow.
 * Hemera remains the source of truth across worker restarts.
 */
export async function processWorkflow(
	options: TranscriptionWorkerOptions,
	initialWorkflow: SeminarRecordingWorkflow,
): Promise<WorkflowStatus> {
	const now = (options.now ?? (() => new Date()))();
	if (initialWorkflow.nextAttemptAt && Date.parse(initialWorkflow.nextAttemptAt) > now.getTime()) {
		return initialWorkflow.status;
	}
	if (initialWorkflow.status === "review_required" || initialWorkflow.status === "ready") {
		return initialWorkflow.status;
	}

	let workflow = initialWorkflow;
	const idempotencyKey = `${workflow.bookingId}:${workflow.recordingId}`;

	if (!workflow.sourceBlobPathname) {
		const staged = await runStage(
			options,
			workflow,
			"source_staging",
			options.breakers.blob,
			async () => {
				const localPath = resolve("output/recordings", `${workflow.recordingId}.mp4`);
				const pathname = await options.providers.uploadToStaging(
					workflow.bookingId,
					workflow.recordingId,
					localPath,
				);
				return pathname;
			},
		);
		workflow = staged.workflow;
		if (!staged.result) return workflow.status;
		workflow = await persist(
			options,
			workflow,
			{
				status: "queued",
				recordingDate: workflow.recordingDate,
				sourceBlobPathname: staged.result,
			},
			"source_staging:complete",
		);
		await options.providers.deleteLocalRecording(workflow.recordingId);
	}

	const sourceBlobPathname = workflow.sourceBlobPathname;
	if (!sourceBlobPathname) {
		throw new Error("WORKFLOW_INVALID: source staging pathname is missing");
	}

	if (!workflow.assemblyAiTranscriptId) {
		const submission = await runStage(
			options,
			workflow,
			"assemblyai_submit",
			options.breakers.assemblyai,
			async () => {
				const sourceUrl = await options.providers.getStagedReadUrl(sourceBlobPathname);
				return options.assemblyai.submitTranscription(
					sourceUrl,
					workflow.recordingId,
					workflow.bookingId,
				);
			},
		);
		workflow = submission.workflow;
		if (!submission.result) return workflow.status;
		workflow = await persist(
			options,
			workflow,
			{
				status: "transcribing",
				recordingDate: workflow.recordingDate,
				assemblyAiTranscriptId: submission.result.id,
				assemblyAiStatus: submission.result.status,
			},
			"assemblyai_submit:complete",
		);
	}

	const assemblyAiTranscriptId = workflow.assemblyAiTranscriptId;
	if (!assemblyAiTranscriptId) {
		throw new Error("WORKFLOW_INVALID: AssemblyAI transcript ID is missing");
	}

	const transcriptResult = await runStage(
		options,
		workflow,
		"assemblyai_fetch",
		options.breakers.assemblyai,
		() => options.assemblyai.getTranscript(assemblyAiTranscriptId),
	);
	workflow = transcriptResult.workflow;
	if (!transcriptResult.result) return workflow.status;
	const transcript = transcriptResult.result;

	if (transcript.status === "queued" || transcript.status === "processing") {
		const nextAttemptAt = new Date(
			now.getTime() + (options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
		).toISOString();
		workflow = await persist(
			options,
			workflow,
			{
				status: "transcribing",
				recordingDate: workflow.recordingDate,
				assemblyAiStatus: transcript.status,
				nextAttemptAt,
			},
			"assemblyai_fetch:pending",
		);
		return workflow.status;
	}

	if (transcript.status !== "completed") {
		workflow = await persist(
			options,
			workflow,
			{
				status: "failed",
				recordingDate: workflow.recordingDate,
				assemblyAiStatus: transcript.status,
				lastErrorCode: "assemblyai_transcript_failed",
				nextAttemptAt: null,
			},
			"assemblyai_fetch:failed-transcript",
		);
		return workflow.status;
	}

	if (workflow.status === "transcribing" || workflow.status === "retryable_failure") {
		workflow = await persist(
			options,
			workflow,
			{
				status: "transcript_ready",
				recordingDate: workflow.recordingDate,
				assemblyAiStatus: transcript.status,
				nextAttemptAt: null,
			},
			"assemblyai_fetch:complete",
		);
	}

	const identification = transcript.speech_understanding?.response?.speaker_identification;
	const automaticMapping = invertSpeakerIdentification(transcript);
	const utterances = transcriptUtterances(transcript);
	const approvedMapping = workflow.status === "publishing" ? operatorMapping(workflow) : null;
	const mappingValidation = approvedMapping
		? validateOperatorMapping(
				approvedMapping.Seminarleiter ?? "",
				approvedMapping.Teilnehmerin ?? "",
				utterances,
			)
		: automaticMapping
			? validateRoleMapping(
					{
						status: identification?.status ?? "",
						speakers: automaticMapping,
					},
					utterances,
				)
			: { valid: false, reason: "speaker_identification_not_successful; review_required" };

	if (!mappingValidation.valid) {
		workflow = await persist(
			options,
			workflow,
			{
				status: "review_required",
				recordingDate: workflow.recordingDate,
				assemblyAiStatus: transcript.status,
				lastErrorCode: mappingValidation.reason.split(";")[0],
				nextAttemptAt: null,
			},
			"transcript_review_required",
		);
		return workflow.status;
	}

	const roleToSpeaker = approvedMapping ?? automaticMapping;
	if (!roleToSpeaker) throw new Error("TRANSCRIPT_INVALID: approved role mapping is missing");
	if (workflow.status !== "publishing") {
		workflow = await persist(
			options,
			workflow,
			{
				status: "publishing",
				recordingDate: workflow.recordingDate,
				assemblyAiStatus: transcript.status,
			},
			"transcript_mapping:accepted",
		);
	}

	if (!workflow.muxAssetId || !workflow.muxPlaybackId || !workflow.muxPlaybackUrl) {
		const ingest = await runStage(
			options,
			workflow,
			"mux_ingest",
			options.breakers.mux,
			async () => {
				const sourceUrl = await options.providers.getStagedReadUrl(sourceBlobPathname);
				return options.providers.ingestToMux(sourceUrl, idempotencyKey);
			},
		);
		workflow = ingest.workflow;
		if (!ingest.result) return workflow.status;
		workflow = await persist(
			options,
			workflow,
			{
				status: "publishing",
				recordingDate: workflow.recordingDate,
				muxAssetId: ingest.result.muxAssetId,
				muxPlaybackId: ingest.result.muxPlaybackId,
				muxPlaybackUrl: ingest.result.muxPlaybackUrl,
				durationSeconds: ingest.result.durationSeconds,
			},
			"mux_ingest:complete",
		);
	}

	if (!workflow.transcriptBlobPathname) {
		const pathname = buildTranscriptPathname(workflow.bookingId, workflow.recordingId);
		const stored = await runStage(
			options,
			workflow,
			"transcript_blob",
			options.breakers.blob,
			async () => {
				await options.providers.storeTranscript(
					pathname,
					formatRoleSeparatedTranscript(transcript, roleToSpeaker),
				);
				return true;
			},
		);
		workflow = stored.workflow;
		if (!stored.result) return workflow.status;
		workflow = await persist(
			options,
			workflow,
			{
				status: "publishing",
				recordingDate: workflow.recordingDate,
				transcriptBlobPathname: pathname,
			},
			"transcript_blob:complete",
		);
	}

	workflow = await persist(
		options,
		workflow,
		{
			status: "ready",
			recordingDate: workflow.recordingDate,
			nextAttemptAt: null,
		},
		"publication:ready",
	);
	try {
		await options.assemblyai.deleteTranscript(assemblyAiTranscriptId);
	} catch (error) {
		reportError(error instanceof Error ? error : new Error(String(error)), undefined, "warning");
	}
	try {
		await deletePrivateBlob(sourceBlobPathname);
	} catch (error) {
		reportError(error instanceof Error ? error : new Error(String(error)), undefined, "warning");
	}
	return workflow.status;
}

/** Processes a bounded set of resumable workflows. */
export async function runWorkerCycle(options: TranscriptionWorkerOptions): Promise<number> {
	const jobs = await options.hemera.listJobs(
		["queued", "transcribing", "transcript_ready", "publishing", "retryable_failure"],
		options.maxJobsPerCycle ?? MAX_JOBS_PER_CYCLE,
	);

	let processed = 0;
	for (const workflow of jobs.items) {
		try {
			await processWorkflow(options, workflow);
			processed += 1;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			console.error(
				`[worker] Workflow ${workflow.bookingId}:${workflow.recordingId} failed:`,
				error.name,
			);
			reportError(
				error,
				{ additionalData: { bookingId: workflow.bookingId, recordingId: workflow.recordingId } },
				"error",
			);
		}
	}
	return processed;
}

export function createWorkerOptions(): TranscriptionWorkerOptions {
	const config = loadConfig();
	if (!config.ASSEMBLY_AI_BASE_URL || !config.ASSEMBLY_AI_API_KEY) {
		throw new Error("ASSEMBLY_AI_NOT_CONFIGURED: base URL and API key are required");
	}
	if (!config.ASSEMBLY_AI_WEBHOOK_SECRET || !config.AITHER_PUBLIC_BASE_URL) {
		throw new Error("WORKER_NOT_CONFIGURED: webhook secret and public base URL are required");
	}

	const webhook = new URL("/api/assemblyai/webhook", config.AITHER_PUBLIC_BASE_URL);
	return {
		hemera: createHemeraSeminarRecordingClient(),
		assemblyai: new AssemblyAiAdapter({
			baseUrl: config.ASSEMBLY_AI_BASE_URL,
			apiKey: config.ASSEMBLY_AI_API_KEY,
			webhookUrl: webhook.toString(),
			webhookSecret: config.ASSEMBLY_AI_WEBHOOK_SECRET,
		}),
		providers: {
			getStagedReadUrl: createStagedReadUrl,
			uploadToStaging: uploadRecordingToStaging,
			deleteLocalRecording: async (recordingId) => {
				const path = resolve("output/recordings", `${recordingId}.mp4`);
				try {
					await unlink(path);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			},
			ingestToMux: ingestStagedSourceToMux,
			storeTranscript: uploadTranscriptToPrivateBlob,
		},
		breakers: {
			assemblyai: new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 }),
			mux: new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 }),
			blob: new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openMs: 30_000 }),
		},
		pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS,
	};
}

/** Worker main entry point, wired to production clients and the polling cycle. */
export async function main(): Promise<void> {
	const options = createWorkerOptions();
	let running = true;
	const shutdown = (signal: string): void => {
		console.log(`[worker] Received ${signal}, shutting down gracefully...`);
		running = false;
	};
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
	console.log("[worker] Transcription worker started");

	while (running) {
		try {
			await runWorkerCycle(options);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			console.error("[worker] Cycle error:", error.name);
			reportError(error, undefined, "error");
		}
		if (running)
			await new Promise((resolveDelay) => setTimeout(resolveDelay, options.pollIntervalMs));
	}
	console.log("[worker] Transcription worker stopped");
}

if (require.main === module) {
	main().catch((err) => {
		console.error("[worker] Fatal error:", err instanceof Error ? err.name : "unknown");
		process.exit(1);
	});
}
