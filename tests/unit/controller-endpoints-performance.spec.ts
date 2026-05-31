import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/route-auth", () => ({
	getRouteAuth: vi.fn().mockResolvedValue({
		sessionClaims: { metadata: { role: "admin" } },
	}),
}));

vi.mock("@/lib/auth/role-check", () => ({
	requireAdmin: vi.fn().mockReturnValue({
		status: 200,
		body: { sessionClaims: { metadata: { role: "admin" } } },
	}),
}));

vi.mock("@/lib/monitoring/rollbar-official", () => ({
	reportError: vi.fn(),
	ErrorSeverity: {
		ERROR: "error",
		WARNING: "warning",
	},
}));

import { POST as postNavigation } from "@/app/api/slides/controller/navigation/route";
import { GET as getController } from "@/app/api/slides/controller/route";
import { resetControllerNavigationState } from "@/lib/slides/controller-navigation";

const WARMUP_COUNT = 1;
const SAMPLE_COUNT = 30;
const TOTAL_CALLS = WARMUP_COUNT + SAMPLE_COUNT;

const MANIFEST_P95_LIMIT_MS = 300;
const NAVIGATION_P95_LIMIT_MS = 250;

function percentile95(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil(sorted.length * 0.95) - 1;
	return sorted[Math.max(0, index)];
}

function getRequest(courseId: string): Request {
	return new Request(`http://localhost:3500/api/slides/controller?courseId=${courseId}`, {
		method: "GET",
	});
}

function postRequest(presentationId: string, fromIndex: number, requestId: string): Request {
	return new Request("http://localhost:3500/api/slides/controller/navigation", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			presentationId,
			command: "next",
			fromIndex,
			requestId,
		}),
	});
}

describe("Performance: Controller Endpoints", () => {
	let tempRoot: string;
	let courseId: string;

	beforeEach(async () => {
		courseId = "perf-course";
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "controller-perf-"));
		const courseDir = path.join(tempRoot, courseId);
		await fs.mkdir(courseDir, { recursive: true });

		for (let i = 1; i <= 50; i += 1) {
			const fileName = `${String(i).padStart(3, "0")}_slide.html`;
			await fs.writeFile(
				path.join(courseDir, fileName),
				`<section><h1>Slide ${i}</h1></section>`,
				"utf8",
			);

			// Mixed notes-state fixture: half of the slides include sidecar note files.
			if (i % 2 === 0) {
				await fs.writeFile(
					path.join(courseDir, `${String(i).padStart(3, "0")}_slide.notes.json`),
					JSON.stringify({ noteTitle: `Note ${i}`, noteBody: `Body ${i}` }),
					"utf8",
				);
			}
		}

		process.env.SLIDES_OUTPUT_DIR = tempRoot;
		resetControllerNavigationState();
	});

	afterEach(async () => {
		Reflect.deleteProperty(process.env, "SLIDES_OUTPUT_DIR");
		resetControllerNavigationState();
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("meets p95 targets with representative fixture load", async () => {
		const manifestDurations: number[] = [];
		for (let i = 0; i < TOTAL_CALLS; i += 1) {
			const start = performance.now();
			const response = await getController(getRequest(courseId));
			const duration = performance.now() - start;
			expect(response.status).toBe(200);
			manifestDurations.push(duration);
		}

		let currentIndex = 0;
		const navigationDurations: number[] = [];
		for (let i = 0; i < TOTAL_CALLS; i += 1) {
			const start = performance.now();
			const response = await postNavigation(
				postRequest(courseId, currentIndex, `perf-nav-${i + 1}`),
			);
			const duration = performance.now() - start;
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				data: { activeSlideIndex: number };
			};
			expect(body.success).toBe(true);
			currentIndex = body.data.activeSlideIndex;
			navigationDurations.push(duration);
		}

		const measuredManifest = manifestDurations.slice(WARMUP_COUNT);
		const measuredNavigation = navigationDurations.slice(WARMUP_COUNT);
		expect(measuredManifest).toHaveLength(SAMPLE_COUNT);
		expect(measuredNavigation).toHaveLength(SAMPLE_COUNT);

		const manifestP95 = percentile95(measuredManifest);
		const navigationP95 = percentile95(measuredNavigation);

		console.log(
			`controller-perf manifestP95=${manifestP95.toFixed(2)}ms navigationP95=${navigationP95.toFixed(2)}ms samples=${SAMPLE_COUNT}`,
		);

		expect(manifestP95).toBeLessThan(MANIFEST_P95_LIMIT_MS);
		expect(navigationP95).toBeLessThan(NAVIGATION_P95_LIMIT_MS);
	});
});
