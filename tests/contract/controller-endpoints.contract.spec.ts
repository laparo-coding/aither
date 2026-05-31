import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRouteAuth = vi.fn().mockResolvedValue({
	sessionClaims: { metadata: { role: "admin" } },
});
const mockRequireAdmin = vi
	.fn()
	.mockReturnValue({ status: 200, body: { sessionClaims: { metadata: { role: "admin" } } } });
const mockReportError = vi.fn();

const mockLoadControllerManifest = vi.fn();
const mockNavigatePresentation = vi.fn();

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: (...args: unknown[]) => mockGetRouteAuth(...args),
}));

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: (...args: unknown[]) => mockReportError(...args),
	ErrorSeverity: {
		ERROR: "error",
		WARNING: "warning",
	},
}));

vi.mock("@/lib/slides/controller-manifest", () => ({
	loadControllerManifest: (...args: unknown[]) => mockLoadControllerManifest(...args),
	isControllerDomainError: (error: unknown) =>
		Boolean(
			error &&
				typeof error === "object" &&
				"code" in (error as Record<string, unknown>) &&
				"status" in (error as Record<string, unknown>),
		),
}));

vi.mock("@/lib/slides/controller-navigation", async () => {
	const actual = await vi.importActual<typeof import("@/lib/slides/controller-navigation")>(
		"@/lib/slides/controller-navigation",
	);
	return {
		...actual,
		navigatePresentation: (...args: unknown[]) => mockNavigatePresentation(...args),
	};
});

import { POST as postNavigation } from "@/app/api/slides/controller/navigation/route";
import { GET as getController } from "@/app/api/slides/controller/route";

function manifestRequest(url: string): Request {
	return new Request(url, { method: "GET" });
}

function navigationRequest(body: unknown): Request {
	return new Request("http://localhost:3500/api/slides/controller/navigation", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function controllerError(
	code: string,
	status: number,
	message: string,
	details?: Record<string, unknown>,
) {
	return Object.assign(new Error(message), { code, status, details });
}

describe("Controller endpoints contract", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRouteAuth.mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } });
		mockRequireAdmin.mockReturnValue({
			status: 200,
			body: { sessionClaims: { metadata: { role: "admin" } } },
		});
		mockLoadControllerManifest.mockResolvedValue({
			courseId: "course-1",
			presentationId: "course-1",
			title: "Presentation course-1",
			aspectRatio: "16:9",
			activeSlideIndex: 0,
			lastUpdated: "2026-05-31T00:00:00.000Z",
			slides: [{ index: 0, fileName: "000_intro.html" }],
		});
		mockNavigatePresentation.mockResolvedValue({
			presentationId: "course-1",
			activeSlideIndex: 1,
			fileName: "001_context.html",
			lastUpdated: "2026-05-31T00:00:00.000Z",
		});
	});

	it("GET /api/slides/controller returns 200 with manifest payload", async () => {
		const res = await getController(
			manifestRequest("http://localhost:3500/api/slides/controller?courseId=course-1"),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.courseId).toBe("course-1");
		expect(body.data.slides[0].fileName).toBe("000_intro.html");
	});

	it("GET /api/slides/controller returns 400 for missing courseId", async () => {
		const res = await getController(manifestRequest("http://localhost:3500/api/slides/controller"));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("GET /api/slides/controller returns 404 for unknown presentation", async () => {
		mockLoadControllerManifest.mockRejectedValue(
			controllerError("PRESENTATION_NOT_FOUND", 404, "No active presentation"),
		);

		const res = await getController(
			manifestRequest("http://localhost:3500/api/slides/controller?courseId=unknown"),
		);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("PRESENTATION_NOT_FOUND");
	});

	it("GET /api/slides/controller keeps payload valid when notes are absent", async () => {
		mockLoadControllerManifest.mockResolvedValue({
			courseId: "course-1",
			presentationId: "course-1",
			title: "Presentation course-1",
			aspectRatio: "16:9",
			activeSlideIndex: 0,
			lastUpdated: "2026-05-31T00:00:00.000Z",
			slides: [{ index: 0, fileName: "000_intro.html" }],
		});

		const res = await getController(
			manifestRequest("http://localhost:3500/api/slides/controller?courseId=course-1"),
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.slides[0].noteTitle).toBeUndefined();
		expect(body.data.slides[0].noteBody).toBeUndefined();
	});

	it("POST /api/slides/controller/navigation returns 200 on valid command", async () => {
		const res = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-1",
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.activeSlideIndex).toBe(1);
	});

	it("POST /api/slides/controller/navigation returns 400 on invalid command", async () => {
		const res = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "jump",
				fromIndex: 0,
				requestId: "req-1",
			}),
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("POST /api/slides/controller/navigation returns 409 on stale index", async () => {
		mockNavigatePresentation.mockRejectedValueOnce(
			controllerError("INDEX_CONFLICT", 409, "Client index stale", {
				expectedIndex: 2,
				providedIndex: 1,
			}),
		);

		const res = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 1,
				requestId: "req-1",
			}),
		);

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe("INDEX_CONFLICT");
		expect(body.error.details.expectedIndex).toBe(2);
	});

	it("POST /api/slides/controller/navigation includes optional notes when provided", async () => {
		mockNavigatePresentation.mockResolvedValueOnce({
			presentationId: "course-1",
			activeSlideIndex: 1,
			fileName: "001_context.html",
			noteTitle: "Coach note",
			noteBody: "Discuss with group",
			lastUpdated: "2026-05-31T00:00:00.000Z",
		});

		const res = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-1",
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.noteTitle).toBe("Coach note");
		expect(body.data.noteBody).toBe("Discuss with group");
	});

	it("both endpoints enforce auth guard", async () => {
		mockRequireAdmin.mockReturnValue({ status: 401, body: { error: "UNAUTHENTICATED" } });

		const manifestRes = await getController(
			manifestRequest("http://localhost:3500/api/slides/controller?courseId=course-1"),
		);
		const navigationRes = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-1",
			}),
		);

		expect(manifestRes.status).toBe(401);
		expect(navigationRes.status).toBe(401);
	});

	it("logs structured error context to Rollbar and avoids secret leakage in response", async () => {
		mockNavigatePresentation.mockRejectedValueOnce(
			controllerError(
				"SLIDE_STATE_UNAVAILABLE",
				503,
				"Slide state unavailable: Bearer secret-token at /Users/test/private/file",
				{ expectedIndex: 1, providedIndex: 0, debug: "token=abc123" },
			),
		);

		const res = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-rollbar",
			}),
		);

		expect(res.status).toBe(503);
		const body = await res.json();
		expect(JSON.stringify(body)).not.toContain("secret-token");
		expect(JSON.stringify(body)).not.toContain("token=abc123");
		expect(mockReportError).toHaveBeenCalled();
	});

	it("concurrency stale-sequence returns conflict on second stale command", async () => {
		mockNavigatePresentation
			.mockResolvedValueOnce({
				presentationId: "course-1",
				activeSlideIndex: 1,
				fileName: "001_context.html",
				lastUpdated: "2026-05-31T00:00:00.000Z",
			})
			.mockRejectedValueOnce(
				controllerError("INDEX_CONFLICT", 409, "Client index stale", {
					expectedIndex: 1,
					providedIndex: 0,
				}),
			);

		const first = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-a",
			}),
		);
		const second = await postNavigation(
			navigationRequest({
				presentationId: "course-1",
				command: "next",
				fromIndex: 0,
				requestId: "req-b",
			}),
		);

		expect(first.status).toBe(200);
		expect(second.status).toBe(409);
	});
});
