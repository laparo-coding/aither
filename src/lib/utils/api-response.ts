// ---------------------------------------------------------------------------
// Standardized API response utilities
// Ported from hemera — consistent error/success response shapes
// ---------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: Record<string, unknown>;
	};
	meta?: {
		requestId: string;
		timestamp: string;
		version?: string;
	};
}

/**
 * Create an error API response
 */
export function createErrorResponse(
	message: string,
	code: string,
	requestId?: string,
	httpStatus?: number,
	details?: Record<string, unknown>,
): Response {
	const errorResponse: ApiResponse<never> = {
		success: false,
		error: { code, message, details },
		meta: {
			requestId: requestId || "unknown",
			timestamp: new Date().toISOString(),
			version: "1.0",
		},
	};

	return Response.json(errorResponse, {
		status: httpStatus || 500,
		headers: {
			"Content-Type": "application/json",
			...(requestId && { "X-Request-ID": requestId }),
		},
	});
}

/**
 * Create a successful API response
 */
export function createSuccessResponse<T>(
	data: T,
	requestId?: string,
	httpStatus?: number,
): Response {
	const successResponse: ApiResponse<T> = {
		success: true,
		data,
		meta: {
			requestId: requestId || "unknown",
			timestamp: new Date().toISOString(),
			version: "1.0",
		},
	};

	return Response.json(successResponse, {
		status: httpStatus || 200,
		headers: {
			"Content-Type": "application/json",
			...(requestId && { "X-Request-ID": requestId }),
		},
	});
}

/**
 * Common error codes
 */
export const ErrorCodes = {
	// Authentication & Authorization
	UNAUTHORIZED: "UNAUTHORIZED",
	FORBIDDEN: "FORBIDDEN",
	INVALID_TOKEN: "INVALID_TOKEN",

	// Validation
	VALIDATION_ERROR: "VALIDATION_ERROR",
	INVALID_INPUT: "INVALID_INPUT",
	MISSING_FIELD: "MISSING_FIELD",

	// Resource
	NOT_FOUND: "NOT_FOUND",
	ALREADY_EXISTS: "ALREADY_EXISTS",
	CONFLICT: "CONFLICT",

	// Server
	INTERNAL_ERROR: "INTERNAL_ERROR",
	DATABASE_ERROR: "DATABASE_ERROR",
	EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",

	// Rate Limiting
	RATE_LIMITED: "RATE_LIMITED",
	TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",

	// Business Logic — Aither-specific
	SYNC_ALREADY_RUNNING: "SYNC_ALREADY_RUNNING",
	SYNC_FAILED: "SYNC_FAILED",
	HEMERA_API_ERROR: "HEMERA_API_ERROR",

	// Recording Module
	RECORDING_ALREADY_RUNNING: "RECORDING_ALREADY_RUNNING",
	NO_ACTIVE_RECORDING: "NO_ACTIVE_RECORDING",
	FFMPEG_NOT_FOUND: "FFMPEG_NOT_FOUND",
	WEBCAM_UNREACHABLE: "WEBCAM_UNREACHABLE",
	MUX_NOT_CONFIGURED: "MUX_NOT_CONFIGURED",
	MUX_UPLOAD_FAILED: "MUX_UPLOAD_FAILED",

	// Timestamp Endpoint (Spec 009)
	INVALID_REQUEST: "INVALID_REQUEST",
	INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
	BLOB_STORAGE_UNAVAILABLE: "BLOB_STORAGE_UNAVAILABLE",

	// Chapters Endpoint (Spec 010)
	RECORDING_NOT_FOUND: "RECORDING_NOT_FOUND",
	FFMETADATA_NOT_FOUND: "FFMETADATA_NOT_FOUND",
	FFMETADATA_INVALID: "FFMETADATA_INVALID",
	RECORDING_IN_PROGRESS: "RECORDING_IN_PROGRESS",
	REMUX_FAILED: "REMUX_FAILED",
	CHAPTER_EXTRACTION_FAILED: "CHAPTER_EXTRACTION_FAILED",
	CHAPTERS_NOT_GENERATED: "CHAPTERS_NOT_GENERATED",
	CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
