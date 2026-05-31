import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolvePresentation = vi.fn();
const activeIndexState = new Map<string, number>();

vi.mock("@/lib/slides/controller-manifest", () => ({
	resolvePresentationSnapshotByPresentationId: (...args: unknown[]) =>
		mockResolvePresentation(...args),
	getActiveIndexForPresentation: (presentationId: string) => activeIndexState.get(presentationId),
	setActiveIndexForPresentation: (presentationId: string, index: number) => {
		activeIndexState.set(presentationId, index);
	},
	resetControllerManifestState: () => {
		activeIndexState.clear();
	},
}));

describe("controller-navigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		activeIndexState.clear();
		mockResolvePresentation.mockResolvedValue({
			courseId: "course-1",
			presentationId: "course-1",
			title: "Presentation course-1",
			aspectRatio: "16:9",
			activeSlideIndex: 0,
			lastUpdated: "2026-05-31T00:00:00.000Z",
			slides: [
				{ index: 0, fileName: "000_intro.html" },
				{ index: 1, fileName: "001_context.html" },
			],
		});
	});

	it("moves to next slide when fromIndex matches current server state", async () => {
		const { navigatePresentation, resetControllerNavigationState } = await import(
			"@/lib/slides/controller-navigation"
		);
		resetControllerNavigationState();

		const result = await navigatePresentation({
			presentationId: "course-1",
			command: "next",
			fromIndex: 0,
			requestId: "req-1",
		});

		expect(result.activeSlideIndex).toBe(1);
		expect(result.fileName).toBe("001_context.html");
	});

	it("returns unchanged index for previous at boundary 0", async () => {
		const { navigatePresentation, resetControllerNavigationState } = await import(
			"@/lib/slides/controller-navigation"
		);
		resetControllerNavigationState();

		const result = await navigatePresentation({
			presentationId: "course-1",
			command: "previous",
			fromIndex: 0,
			requestId: "req-2",
		});

		expect(result.activeSlideIndex).toBe(0);
		expect(result.fileName).toBe("000_intro.html");
	});

	it("returns conflict when fromIndex is stale", async () => {
		const { navigatePresentation, resetControllerNavigationState } = await import(
			"@/lib/slides/controller-navigation"
		);
		resetControllerNavigationState();

		await navigatePresentation({
			presentationId: "course-1",
			command: "next",
			fromIndex: 0,
			requestId: "req-a",
		});

		await expect(
			navigatePresentation({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-b",
			}),
		).rejects.toMatchObject({
			code: "INDEX_CONFLICT",
			status: 409,
		});
	});

	it("returns unchanged index for next at upper boundary", async () => {
		const { navigatePresentation, resetControllerNavigationState } = await import(
			"@/lib/slides/controller-navigation"
		);
		resetControllerNavigationState();

		await navigatePresentation({
			presentationId: "course-1",
			command: "next",
			fromIndex: 0,
			requestId: "req-a",
		});

		const result = await navigatePresentation({
			presentationId: "course-1",
			command: "next",
			fromIndex: 1,
			requestId: "req-b",
		});

		expect(result.activeSlideIndex).toBe(1);
		expect(result.fileName).toBe("001_context.html");
	});
});
