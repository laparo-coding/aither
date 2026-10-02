// ---------------------------------------------------------------------------
// Transcription Feature — Domain Types
// Task: T012 — Inferred types from the Zod schemas
// ---------------------------------------------------------------------------

import type { z } from "zod";
import type {
	AssemblyAiCallbackSchema,
	BookingContextSchema,
	CleanupStatusSchema,
	DeletionReasonSchema,
	DeletionRequestSchema,
	JobListingSchema,
	MediaAccessResponseSchema,
	OperatorReviewSchema,
	SeminarRecordingWorkflowSchema,
	TraceEventSchema,
	WorkflowStatusSchema,
	WorkflowUpdateSchema,
} from "./schemas";

export type BookingContext = z.infer<typeof BookingContextSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type CleanupStatus = z.infer<typeof CleanupStatusSchema>;
export type DeletionReason = z.infer<typeof DeletionReasonSchema>;
export type WorkflowUpdate = z.infer<typeof WorkflowUpdateSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type SeminarRecordingWorkflow = z.infer<typeof SeminarRecordingWorkflowSchema>;
export type JobListing = z.infer<typeof JobListingSchema>;
export type AssemblyAiCallback = z.infer<typeof AssemblyAiCallbackSchema>;
export type OperatorReview = z.infer<typeof OperatorReviewSchema>;
export type MediaAccessResponse = z.infer<typeof MediaAccessResponseSchema>;
export type DeletionRequest = z.infer<typeof DeletionRequestSchema>;

/** The two required seminar roles for speaker mapping. */
export const SEMINAR_ROLES = ["Seminarleiter", "Teilnehmerin"] as const;
export type SeminarRole = (typeof SEMINAR_ROLES)[number];

/** A single diarized utterance before role mapping. */
export interface DiarizedUtterance {
	speakerId: string | null;
	text: string;
	startMs?: number;
	endMs?: number;
}

/** Result of the automatic mapping validation. */
export interface MappingValidationResult {
	valid: boolean;
	reason: string;
	orderedUtterances?: Array<{ speakerId: string | null; text: string; start: number }>;
}
