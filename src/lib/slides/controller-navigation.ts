import { randomUUID } from "node:crypto";
import { ErrorSeverity, reportError } from "@/lib/monitoring/rollbar-official";
import {
	getActiveIndexForPresentation,
	resetControllerManifestState,
	resolvePresentationSnapshotByPresentationId,
	setActiveIndexForPresentation,
} from "@/lib/slides/controller-manifest";
import {
	type ControllerCode,
	type ControllerErrorBody,
	type ControllerNavigationRequest,
	type ControllerNavigationResult,
	controllerNavigationResultSchema,
} from "@/lib/slides/controller-types";
export function resetControllerNavigationState(): void {
	resetControllerManifestState();
}

function getCurrentIndex(presentationId: string, defaultIndex: number): number {
	const currentIndex = getActiveIndexForPresentation(presentationId);
	if (currentIndex === undefined) {
		setActiveIndexForPresentation(presentationId, defaultIndex);
		return defaultIndex;
	}
	return currentIndex;
}

function sanitizeString(value: string): string {
	return value
		.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
		.replace(/\b(token|secret|authorization)\s*[:=]\s*[^,\s}]+/gi, "$1=[REDACTED]")
		.replace(/\/(Users|home|var|private|tmp)\/[^\s"']+/g, "[REDACTED_PATH]");
}

function sanitizeDetails(details?: Record<string, string | number | boolean>) {
	if (!details) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(details).map(([key, value]) => [
			key,
			typeof value === "string" ? sanitizeString(value) : value,
		]),
	);
}

function clampIndex(index: number, lastIndex: number): number {
	if (index < 0) return 0;
	if (index > lastIndex) return lastIndex;
	return index;
}

function createControllerError(
	code: ControllerCode,
	status: number,
	message: string,
	details?: Record<string, string | number | boolean>,
): Error & {
	code: ControllerCode;
	status: number;
	details?: Record<string, string | number | boolean>;
} {
	return Object.assign(new Error(message), { code, status, details });
}

function isControllerErrorLike(error: unknown): error is Error & {
	code: ControllerCode;
	status: number;
	details?: Record<string, string | number | boolean>;
} {
	return (
		error instanceof Error &&
		typeof (error as { code?: unknown }).code === "string" &&
		typeof (error as { status?: unknown }).status === "number"
	);
}

export async function navigatePresentation(
	request: ControllerNavigationRequest,
	outputDir?: string,
): Promise<ControllerNavigationResult> {
	const snapshot = await resolvePresentationSnapshotByPresentationId(
		request.presentationId,
		outputDir,
	);

	const lastIndex = Math.max(snapshot.slides.length - 1, 0);
	const currentIndex = getCurrentIndex(request.presentationId, snapshot.activeSlideIndex);

	if (request.fromIndex !== currentIndex) {
		throw createControllerError(
			"INDEX_CONFLICT",
			409,
			"Client index does not match current presentation state.",
			{
				expectedIndex: currentIndex,
				providedIndex: request.fromIndex,
			},
		);
	}

	const requestedIndex = request.command === "next" ? currentIndex + 1 : currentIndex - 1;
	const nextIndex = clampIndex(requestedIndex, lastIndex);
	setActiveIndexForPresentation(request.presentationId, nextIndex);

	const activeSlide = snapshot.slides[nextIndex];
	if (!activeSlide) {
		throw createControllerError(
			"SLIDE_STATE_UNAVAILABLE",
			503,
			"Slide state unavailable for resolved index.",
			{ nextIndex },
		);
	}

	return controllerNavigationResultSchema.parse({
		presentationId: request.presentationId,
		activeSlideIndex: nextIndex,
		fileName: activeSlide.fileName,
		noteTitle: activeSlide.noteTitle,
		noteBody: activeSlide.noteBody,
		lastUpdated: new Date().toISOString(),
	});
}

export function toControllerErrorResponse(
	error: unknown,
	requestId: string = randomUUID(),
): { status: number; body: { success: false; error: ControllerErrorBody } } {
	if (isControllerErrorLike(error)) {
		if (error.status >= 500) {
			reportError(
				error,
				{
					requestId,
					additionalData: {
						errorCategory: "controller",
						severity: "error",
						code: error.code,
					},
				},
				ErrorSeverity.ERROR,
			);
		}
		return {
			status: error.status,
			body: {
				success: false,
				error: {
					code: error.code,
					message: sanitizeString(error.message),
					requestId,
					details: sanitizeDetails(error.details),
				},
			},
		};
	}

	reportError(
		error instanceof Error ? error : new Error(String(error)),
		{
			requestId,
			additionalData: {
				errorCategory: "controller",
				severity: "error",
				code: "INTERNAL_ERROR",
			},
		},
		ErrorSeverity.ERROR,
	);

	return {
		status: 500,
		body: {
			success: false,
			error: {
				code: "INTERNAL_ERROR",
				message: "Unexpected controller error.",
				requestId,
			},
		},
	};
}
