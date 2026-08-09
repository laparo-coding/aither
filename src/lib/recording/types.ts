// ---------------------------------------------------------------------------
// Recording Module — TypeScript Types (Inferred from Zod Schemas)
// Task: T005 — All recording-related types
// ---------------------------------------------------------------------------

import type { z } from "zod";
import type {
	ChapterBoundaryEventSchema,
	ChapterListResponseSchema,
	ChapterPlaybackRequestSchema,
	ChapterPlaybackResultSchema,
	ChapterRegenerationResultSchema,
	ChapterSummarySchema,
	FFMetadataChapterSchema,
	FFMetadataJSONSchema,
	MuxUploadRequestSchema,
	MuxUploadResponseSchema,
	PlaybackCommandSchema,
	PlaybackResponseSchema,
	PlaybackStateSchema,
	PlayerState,
	PlayerStateReportSchema,
	RecordingFileSchema,
	RecordingListResponseSchema,
	RecordingSessionSchema,
	RecordingStatus,
	RecordingStatusActiveSchema,
	RecordingStatusInactiveSchema,
	SeekCommandSchema,
	StartRecordingResponseSchema,
	StopRecordingResponseSchema,
	TimestampIngestionResultSchema,
	TimestampRequestSchema,
} from "./schemas";

// ── Enum Types ────────────────────────────────────────────────────────────

export type RecordingStatusType = z.infer<typeof RecordingStatus>;
export type PlayerStateType = z.infer<typeof PlayerState>;

// ── Entity Types ──────────────────────────────────────────────────────────

export type RecordingSession = z.infer<typeof RecordingSessionSchema>;
export type RecordingFile = z.infer<typeof RecordingFileSchema>;
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;

// ── Request Types ─────────────────────────────────────────────────────────

export type PlaybackCommand = z.infer<typeof PlaybackCommandSchema>;
export type SeekCommand = z.infer<typeof SeekCommandSchema>;
export type PlayerStateReport = z.infer<typeof PlayerStateReportSchema>;
export type MuxUploadRequest = z.infer<typeof MuxUploadRequestSchema>;

// ── Response Types ────────────────────────────────────────────────────────

export type StartRecordingResponse = z.infer<typeof StartRecordingResponseSchema>;
export type StopRecordingResponse = z.infer<typeof StopRecordingResponseSchema>;
export type RecordingStatusActive = z.infer<typeof RecordingStatusActiveSchema>;
export type RecordingStatusInactive = z.infer<typeof RecordingStatusInactiveSchema>;
export type RecordingListResponse = z.infer<typeof RecordingListResponseSchema>;
export type PlaybackResponse = z.infer<typeof PlaybackResponseSchema>;
export type MuxUploadResponse = z.infer<typeof MuxUploadResponseSchema>;

// ── Timestamp Endpoint Types (Spec 009) ───────────────────────────────────

export type TimestampRequest = z.infer<typeof TimestampRequestSchema>;
export type FFMetadataChapter = z.infer<typeof FFMetadataChapterSchema>;
export type FFMetadataJSON = z.infer<typeof FFMetadataJSONSchema>;
export type TimestampIngestionResult = z.infer<typeof TimestampIngestionResultSchema>;

// ── Chapter Endpoint Types (Spec 010) ──────────────────────────────────────

export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type ChapterListResponse = z.infer<typeof ChapterListResponseSchema>;
export type ChapterRegenerationResult = z.infer<typeof ChapterRegenerationResultSchema>;
export type ChapterPlaybackRequest = z.infer<typeof ChapterPlaybackRequestSchema>;
export type ChapterPlaybackResult = z.infer<typeof ChapterPlaybackResultSchema>;
export type ChapterBoundaryEvent = z.infer<typeof ChapterBoundaryEventSchema>;

// ── SSE Types ─────────────────────────────────────────────────────────────

export type SSECommand =
	| { action: "play" }
	| { action: "stop" }
	| { action: "seek"; position: number }
	| { action: "chapter-boundary"; chapterId: number; nextChapterId?: number };
