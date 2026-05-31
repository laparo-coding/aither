import {
	controllerManifestSchema,
	courseIdSchema,
	parseCourseId,
} from "@/lib/slides/controller-types";
import { describe, expect, it } from "vitest";

describe("controller-types", () => {
	it("rejects courseIds with leading, trailing, or repeated separators", () => {
		expect(() => courseIdSchema.parse(".course")).toThrow();
		expect(() => courseIdSchema.parse("course-")).toThrow();
		expect(() => courseIdSchema.parse("course..id")).toThrow();
		expect(() => courseIdSchema.parse("..")).toThrow();
	});

	it("requires a non-null courseId before parsing", () => {
		expect(() => parseCourseId("course_1")).not.toThrow();
	});

	it("rejects manifests whose activeSlideIndex exceeds slide bounds", () => {
		expect(() =>
			controllerManifestSchema.parse({
				courseId: "course_1",
				presentationId: "course_1",
				title: "Presentation course_1",
				aspectRatio: "16:9",
				activeSlideIndex: 2,
				lastUpdated: "2026-05-31T00:00:00.000Z",
				slides: [{ index: 0, fileName: "000_intro.html" }],
			}),
		).toThrow(/activeSlideIndex must reference an existing slide/);
	});
});
