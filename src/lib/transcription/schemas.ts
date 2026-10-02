// ---------------------------------------------------------------------------
// Transcription Feature — Zod Validation Schemas
// Task: T012 — Request/response schemas for booking context, workflow state,
// AssemblyAI callback, operator review, media-access response, and deletion
// jobs per specs/012-video-transcription/contracts/seminar-recording-api.openapi.yaml
// ---------------------------------------------------------------------------

import { z } from "zod";

// --- Booking Context ---

export const BookingContextSchema = z.object({
	bookingId: z.string().min(1),
	participantUserId: z.string().min(1),
	courseId: z.string().min(1),
});

// --- Workflow Status ---

export const WorkflowStatusSchema = z.enum([
	"queued",
	"transcribing",
	"transcript_ready",
	"review_required",
	"publishing",
	"ready",
	"retryable_failure",
	"failed",
	"deletion_pending",
	"deleted",
]);

export const CleanupStatusSchema = z.enum([
	"pending",
	"complete",
	"retryable_failure",
	"not_required",
]);

export const DeletionReasonSchema = z.enum([
	"booking_deleted",
	"participation_deleted",
	"operator_abandoned",
]);

// --- Workflow Update (PUT body) ---

export const WorkflowUpdateSchema = z.object({
	status: WorkflowStatusSchema,
	recordingDate: z.string().datetime(),
	queuedAt: z.string().datetime().optional(),
	firstProviderAttemptAt: z.string().datetime().nullish(),
	assemblyAiTranscriptId: z.string().nullish(),
	assemblyAiStatus: z.string().nullish(),
	sourceBlobPathname: z.string().nullish(),
	muxAssetId: z.string().nullish(),
	muxPlaybackId: z.string().nullish(),
	muxPlaybackUrl: z.string().url().nullish(),
	durationSeconds: z.number().positive().nullish(),
	transcriptBlobPathname: z.string().nullish(),
	lastErrorCode: z.string().nullish(),
	stageAttemptCounts: z.record(z.string(), z.number().int().min(0).max(5)).optional(),
	nextAttemptAt: z.string().datetime().nullish(),
	assemblyAiCleanupStatus: CleanupStatusSchema.optional(),
	sourceBlobCleanupStatus: CleanupStatusSchema.optional(),
	reviewedSpeakerMapping: z.record(z.string(), z.string()).nullish(),
	reviewedBy: z.string().nullish(),
	reviewedAt: z.string().datetime().nullish(),
	deletionRequestedAt: z.string().datetime().nullish(),
	deletionConfirmedAt: z.string().datetime().nullish(),
	deletionReason: DeletionReasonSchema.nullish(),
});

// --- Workflow Record (GET response) ---

export const TraceEventSchema = z.object({
	eventType: z.string().min(1),
	fromStatus: z.string().nullish(),
	toStatus: z.string().nullish(),
	providerReference: z.string().nullish(),
	errorCode: z.string().nullish(),
	operatorId: z.string().nullish(),
	occurredAt: z.string().datetime(),
});

export const SeminarRecordingWorkflowSchema = WorkflowUpdateSchema.extend({
	bookingId: z.string().min(1),
	participantUserId: z.string().min(1),
	recordingId: z.string().min(1),
	traceEvents: z.array(TraceEventSchema).optional(),
});

// --- Job Listing ---

export const JobListingSchema = z.object({
	items: z.array(SeminarRecordingWorkflowSchema),
});

// --- AssemblyAI Callback ---

export const AssemblyAiCallbackSchema = z.object({
	transcript_id: z.string().min(1),
	status: z.enum(["completed", "error"]),
});

// --- Operator Review ---

export const OperatorReviewSchema = z.object({
	bookingId: z.string().min(1),
	participantSpeakerId: z.string().min(1),
	leaderSpeakerId: z.string().min(1),
	approve: z.literal(true),
});

// --- Media Access Response ---

export const MediaAccessResponseSchema = z.object({
	muxPlaybackUrl: z.string().url(),
	transcriptUrl: z.string().url(),
	muxExpiresAt: z.string().datetime(),
	transcriptExpiresAt: z.string().datetime(),
});

// --- Deletion Request ---

export const DeletionRequestSchema = z.object({
	bookingId: z.string().min(1),
	deletionId: z.string().min(1),
	deletionReason: DeletionReasonSchema.optional(),
});
