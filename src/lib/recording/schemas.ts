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

// ── Chapter Endpoint Schemas (Spec 010) ────────────────────────────────────

/** Individual chapter metadata extracted from the MUX chaptered asset. */
export const ChapterSummarySchema = z
	.object({
		id: z.number().int().min(0),
		start: z.number().min(0).finite(),
		end: z.number().finite(),
		title: z.string().min(1).max(255),
	})
	.refine((data) => data.end > data.start, {
		message: "end must be greater than start",
		path: ["end"],
	});

/** Response body for GET /api/recording/chapters/[id]. */
export const ChapterListResponseSchema = z.object({
	assetId: z.string().min(1),
	chapters: z
		.array(ChapterSummarySchema)
		.min(1)
		.superRefine((chapters, ctx) => {
			for (let i = 0; i < chapters.length; i++) {
				if (chapters[i].id !== i) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "chapter ids must be continuous and zero-based",
						path: [i, "id"],
					});
				}

				if (i < chapters.length - 1 && chapters[i].end > chapters[i + 1].start) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "chapters must not overlap and must be ordered by time",
						path: [i + 1, "start"],
					});
				}
			}
		}),
});

/** Response body for POST /api/recording/chapters/[id] (regenerate). */
export const ChapterRegenerationResultSchema = z.object({
	assetId: z.string().min(1),
	muxAssetId: z.string().min(1),
	chapterCount: z.number().int().min(1),
});

/** Request body for extended POST /api/recording/playback/play. */
export const ChapterPlaybackRequestSchema = z.object({
	recordingId: z.string().min(1),
	chapterId: z.number().int().min(0).optional(),
});

/** Response body for extended POST /api/recording/playback/play. */
export const ChapterPlaybackResultSchema = z.union([
	z
		.object({
			accepted: z.literal(true),
		})
		.strict(),
	z
		.object({
			accepted: z.literal(true),
			chapterId: z.number().int().min(0),
			start: z.number().min(0).finite(),
			end: z.number().finite(),
		})
		.refine((data) => data.end > data.start, {
			message: "end must be greater than start",
			path: ["end"],
		}),
]);

/** SSE event payload emitted when the player reaches a chapter boundary. */
export const ChapterBoundaryEventSchema = z.object({
	chapterId: z.number().int().min(0),
	nextChapterId: z.number().int().min(0).optional(),
	timestamp: z.number().int().optional(),
});
