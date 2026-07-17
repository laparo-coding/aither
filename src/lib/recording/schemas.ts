// ---------------------------------------------------------------------------
// Recording Module — Zod Schemas (Source of Truth)
// Task: T004 — All recording-related validation schemas
// ---------------------------------------------------------------------------

import { z } from "zod";

// ── Enums ─────────────────────────────────────────────────────────────────

export const RecordingStatus = z.enum([
	"starting",
	"recording",
	"stopping",
	"completed",
	"failed",
	"interrupted",
]);

export const PlayerState = z.enum(["idle", "playing", "paused", "ended", "error"]);

// ── Session ID pattern ────────────────────────────────────────────────────

/** Pattern: rec_YYYY-MM-DDTHH-MM-SSZ */
const SESSION_ID_PATTERN = /^rec_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

export const SessionIdSchema = z.string().regex(SESSION_ID_PATTERN, {
	message: "Session ID must match pattern rec_YYYY-MM-DDTHH-MM-SSZ",
});

// ── Core Entity Schemas ───────────────────────────────────────────────────

export const RecordingSessionSchema = z.object({
	sessionId: SessionIdSchema,
	filename: z.string().min(1),
	status: RecordingStatus,
	startedAt: z.string().datetime(),
	endedAt: z.string().datetime().nullable(),
	duration: z.number().min(0).max(900).nullable(),
	fileSize: z.number().min(0).nullable(),
	filePath: z.string().min(1),
	maxDurationReached: z.boolean(),
	error: z.string().nullable(),
});

export const RecordingFileSchema = z.object({
	id: SessionIdSchema,
	filename: z.string().min(1),
	duration: z
		.number()
		.gt(0, { message: "Duration must be greater than 0 (zero-length files are invalid)" }),
	fileSize: z.number().min(0),
	createdAt: z.string().datetime(),
	filePath: z.string().min(1),
});

export const PlaybackStateSchema = z.object({
	recordingId: z.string().min(1),
	state: PlayerState,
	position: z.number().min(0),
	connectedAt: z.string().datetime(),
	lastUpdated: z.string().datetime(),
	errorMessage: z.string().nullable(),
});

// ── API Request Schemas ───────────────────────────────────────────────────

export const PlaybackCommandSchema = z.object({
	recordingId: z.string().min(1),
});

export const SeekCommandSchema = z.object({
	recordingId: z.string().min(1),
	seconds: z.number().min(0),
});

export const PlayerStateReportSchema = z.object({
	recordingId: z.string().min(1),
	state: z.enum(["playing", "paused", "ended", "error"]),
	position: z.number().min(0),
	message: z.string().optional(),
});

export const MuxUploadRequestSchema = z.object({
	seminarSourceId: z.string().min(1),
});

// ── API Response Schemas ──────────────────────────────────────────────────

export const StartRecordingResponseSchema = z.object({
	sessionId: SessionIdSchema,
	filename: z.string().min(1),
	startedAt: z.string().datetime(),
});

export const StopRecordingResponseSchema = z.object({
	sessionId: SessionIdSchema,
	filename: z.string().min(1),
	duration: z.number().min(0).max(900),
	fileSize: z.number().min(0),
	filePath: z.string().min(1),
});

export const RecordingStatusActiveSchema = z.object({
	recording: z.literal(true),
	sessionId: SessionIdSchema,
	startedAt: z.string().datetime(),
	filename: z.string().min(1),
});

export const RecordingStatusInactiveSchema = z.object({
	recording: z.literal(false),
});

export const RecordingListResponseSchema = z.object({
	recordings: z.array(RecordingFileSchema),
});

export const PlaybackResponseSchema = z.object({
	status: z.enum(["playing", "paused"]),
	position: z.number().min(0),
});

export const MuxUploadResponseSchema = z.object({
	muxAssetId: z.string().min(1),
	muxPlaybackUrl: z.string().url(),
	seminarSourceId: z.string().min(1),
	transmitted: z.boolean(),
	transmissionError: z.string().nullable().optional(),
});

// ── Timestamp Endpoint Schemas (Spec 009) ─────────────────────────────────

export const TimestampRequestSchema = z.object({
	timestamp: z.number().int().positive(),
});

export const FFMetadataChapterSchema = z
	.object({
		id: z.number().int().min(0),
		start: z.number().int().min(0),
		end: z.number().int().min(0),
		title: z.string().min(1),
	})
	.refine((c) => c.end >= c.start, { message: "end must be >= start" });

export const FFMetadataJSONSchema = z.object({
	metadata: z.object({
		title: z.string().min(1),
		encoder: z.literal("aither-ffmetadata"),
	}),
	chapters: z.array(FFMetadataChapterSchema).min(1, "chapters must contain at least one entry"),
});

export const TimestampIngestionResultSchema = z.object({
	assetId: z.string().min(1),
	chapterId: z.number().int().min(0),
	blobKey: z.string().min(1),
});
