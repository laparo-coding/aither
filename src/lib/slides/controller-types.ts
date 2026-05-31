import { z } from "zod";

export const controllerCodeEnum = z.enum([
	"INVALID_REQUEST",
	"UNAUTHORIZED",
	"PRESENTATION_NOT_FOUND",
	"INDEX_CONFLICT",
	"SLIDE_STATE_UNAVAILABLE",
	"INTERNAL_ERROR",
]);

export const courseIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^(?!.*[.-]{2})[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9_])?$/, "Invalid courseId");

export const commandSchema = z.enum(["previous", "next"]);

export const controllerSlideRefSchema = z.object({
	index: z.number().int().min(0),
	fileName: z.string().min(1),
	noteTitle: z.string().optional(),
	noteBody: z.string().optional(),
});

export const controllerManifestSchema = z
	.object({
		courseId: courseIdSchema,
		presentationId: z.string().min(1),
		title: z.string().min(1),
		aspectRatio: z.string().min(1),
		activeSlideIndex: z.number().int().min(0),
		lastUpdated: z.string().datetime(),
		slides: z.array(controllerSlideRefSchema),
	})
	.superRefine((manifest, ctx) => {
		if (manifest.activeSlideIndex >= manifest.slides.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "activeSlideIndex must reference an existing slide",
				path: ["activeSlideIndex"],
			});
		}
	});

export const controllerNavigationRequestSchema = z.object({
	presentationId: z.string().min(1),
	command: commandSchema,
	fromIndex: z.number().int().min(0),
	requestId: z.string().min(1),
});

export const controllerNavigationResultSchema = z.object({
	presentationId: z.string().min(1),
	activeSlideIndex: z.number().int().min(0),
	fileName: z.string().min(1),
	lastUpdated: z.string().datetime(),
	noteTitle: z.string().optional(),
	noteBody: z.string().optional(),
});

export const controllerErrorSchema = z.object({
	code: controllerCodeEnum,
	message: z.string().min(1),
	requestId: z.string().optional(),
	details: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type ControllerCode = z.infer<typeof controllerCodeEnum>;
export type ControllerSlideRef = z.infer<typeof controllerSlideRefSchema>;
export type ControllerManifest = z.infer<typeof controllerManifestSchema>;
export type ControllerNavigationRequest = z.infer<typeof controllerNavigationRequestSchema>;
export type ControllerNavigationResult = z.infer<typeof controllerNavigationResultSchema>;
export type ControllerErrorBody = z.infer<typeof controllerErrorSchema>;

export function parseCourseId(courseId: string): string {
	return courseIdSchema.parse(courseId);
}

export function parseControllerNavigationRequest(payload: unknown): ControllerNavigationRequest {
	return controllerNavigationRequestSchema.parse(payload);
}
