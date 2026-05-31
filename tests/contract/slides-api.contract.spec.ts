// ---------------------------------------------------------------------------
// Contract Tests: Slides API
// Task: T014 [US4] — POST /api/slides: 200, 401, 403, 409
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockReaddir = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: (...args: unknown[]) => mockReadFile(...args),
		readdir: (...args: unknown[]) => mockReaddir(...args),
		stat: (...args: unknown[]) => mockStat(...args),
	},
	readFile: (...args: unknown[]) => mockReadFile(...args),
	readdir: (...args: unknown[]) => mockReaddir(...args),
	stat: (...args: unknown[]) => mockStat(...args),
}));

// Mock loadConfig
vi.mock("@/lib/config", () => ({
	loadConfig: vi.fn(() => ({
		HEMERA_API_BASE_URL: "https://api.hemera.test",
		HEMERA_API_KEY: "test-key-minimum-32-characters-long-for-validation",
		SLIDES_OUTPUT_DIR: "output/slides",
	})),
}));

// Mock auth — default: admin
vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({ sessionClaims: { metadata: { role: "admin" } } }),
}));

const mockRequireAdmin = vi.fn().mockReturnValue({
	status: 200,
	body: { sessionClaims: { metadata: { role: "admin" } } },
});

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// Mock SlideGenerator
const mockGenerate = vi.fn().mockResolvedValue({
	slidesGenerated: 5,
	courseTitle: "Test Course",
	courseId: "sem-1",
	slides: [],
});

vi.mock("@/lib/slides/generator", () => ({
	SlideGenerator: vi.fn().mockImplementation(() => ({
		generate: mockGenerate,
	})),
}));

// Mock HemeraClient
vi.mock("@/lib/hemera/client", () => ({
	HemeraClient: vi.fn().mockImplementation(() => ({})),
}));

// Mock factory — prevent getTokenManager() from requiring HEMERA_API_KEY env var
vi.mock("@/lib/hemera/factory", () => ({
	createHemeraClient: vi.fn(() => ({
		get: vi.fn().mockResolvedValue([]),
		put: vi.fn().mockResolvedValue({}),
	})),
}));

// Mock Rollbar
vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
}));

import { POST, _resetState } from "@/app/api/slides/route";
import { NextRequest } from "next/server";

function createRequest(): NextRequest {
	return new NextRequest(new URL("http://localhost:3000/api/slides"), { method: "POST" });
}

function createGetRequest(url: string): NextRequest {
	return new NextRequest(new URL(url), { method: "GET" });
}

describe("POST /api/slides", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetState();
		mockRequireAdmin.mockReturnValue({
			status: 200,
			body: { sessionClaims: { metadata: { role: "admin" } } },
		});
		mockGenerate.mockResolvedValue({
			slidesGenerated: 5,
			courseTitle: "Test Course",
			courseId: "sem-1",
			slides: [],
		});
	});

	it("returns 200 with slide count on success", async () => {
		const res = await POST(createRequest());

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("success");
		expect(body.slidesGenerated).toBe(5);
		expect(body.courseTitle).toBe("Test Course");
	});

	it("returns 401 for unauthenticated requests", async () => {
		mockRequireAdmin.mockReturnValue({
			status: 401,
			body: { error: "UNAUTHENTICATED" },
		});

		const res = await POST(createRequest());

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("UNAUTHENTICATED");
	});

	it("returns 403 for non-admin users", async () => {
		mockRequireAdmin.mockReturnValue({
			status: 403,
			body: { error: "FORBIDDEN" },
		});

		const res = await POST(createRequest());

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toBe("FORBIDDEN");
	});

	it("returns 409 when slide generation is already running", async () => {
		let resolveGenerate!: () => void;
		mockGenerate.mockImplementation(
			() =>
				new Promise<unknown>((resolve) => {
					resolveGenerate = () =>
						resolve({
							slidesGenerated: 5,
							courseTitle: "Test",
							courseId: "sem-1",
							slides: [],
						});
				}),
		);

		// Start first request (won't resolve until we call resolveGenerate)
		const promise1 = POST(createRequest());

		// Yield to allow the route handler to reach the generate() call and set the mutex
		await new Promise((r) => setTimeout(r, 50));

		// Second request should get 409
		const res2 = await POST(createRequest());
		expect(res2.status).toBe(409);
		const body = await res2.json();
		expect(body.error).toBe("SLIDES_ALREADY_RUNNING");

		// Clean up: resolve the first request
		resolveGenerate();
		await promise1;
	});
});

describe("Adjacent endpoint regression contracts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET /api/slides/status keeps generated payload shape", async () => {
		mockReaddir.mockResolvedValue(["slide-1.html", "slide-2.html", "note.txt"]);
		mockStat.mockResolvedValue({ mtimeMs: Date.parse("2026-05-31T10:00:00.000Z") });

		const { GET } = await import("@/app/api/slides/status/route");
		const res = await GET(
			createGetRequest("http://localhost:3000/api/slides/status?courseId=sem-1"),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			status: "generated",
			slideCount: 2,
		});
		expect(typeof body.lastUpdated).toBe("string");
		expect(Object.keys(body).sort()).toEqual(["lastUpdated", "slideCount", "status"]);
	});

	it("GET /api/slides/status keeps not-generated payload shape on invalid input", async () => {
		const { GET } = await import("@/app/api/slides/status/route");
		const res = await GET(
			createGetRequest("http://localhost:3000/api/slides/status?courseId=../../bad"),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "not-generated", slideCount: 0, lastUpdated: null });
	});

	it("GET /api/slides/view keeps html response contract", async () => {
		mockReadFile.mockResolvedValue("<html><body>slide</body></html>");

		const { GET } = await import("@/app/api/slides/view/route");
		const res = await GET(
			createGetRequest("http://localhost:3000/api/slides/view?courseId=sem-1&file=slide-1.html"),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.text()).toContain("<html>");
	});

	it("GET /api/slides/view keeps error payload contract on invalid file", async () => {
		const { GET } = await import("@/app/api/slides/view/route");
		const res = await GET(
			createGetRequest("http://localhost:3000/api/slides/view?courseId=sem-1&file=../../secret"),
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({ error: "Invalid file" });
	});
});
