// ---------------------------------------------------------------------------
// Performance-Test: Sync mit Mock-Daten (~500 Records)
// Task: T056 [Polish] — Laufzeitmessung < 5 Minuten
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import type { HemeraClient } from "@/lib/hemera/client";
import { SyncOrchestrator } from "@/lib/sync/orchestrator";
import { describe, expect, it } from "vitest";

// Mock-Client, der große Mengen an Daten liefert
class MockHemeraClient {
	get(path: string) {
		if (path === "/templates") {
			return Promise.resolve(
				Array.from({ length: 250 }, (_, i) => ({
					sourceId: `tpl-${i}`,
					seminarId: `sem-${i}`,
					lessonId: null,
					markup: "<html>{{title}}</html>",
					version: "1.0",
				})),
			);
		}
		if (path === "/seminars") {
			return Promise.resolve(
				Array.from({ length: 250 }, (_, i) => ({
					sourceId: `sem-${i}`,
					title: `Seminar ${i}`,
					description: null,
					dates: [],
					instructorIds: [],
					lessonIds: [],
					recordingUrl: null,
				})),
			);
		}
		// Leere Arrays für andere Endpunkte
		return Promise.resolve([]);
	}
	put() {
		return Promise.resolve({ status: 200, message: "OK" });
	}
}

describe("Performance: Sync mit 500 Records", () => {
	it("sollte in < 5 Minuten laufen", async () => {
		const outputDir = path.join("output", "perf-test");
		// Clean output dir to avoid stale manifest causing all files to be "unchanged"
		await fs.rm(outputDir, { recursive: true, force: true });
		// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
		await fs.mkdir(outputDir, { recursive: true });
		const orchestrator = new SyncOrchestrator({
			client: new MockHemeraClient() as unknown as HemeraClient,
			outputDir,
			manifestPath: path.join(outputDir, ".sync-manifest.json"),
		});
		const start = Date.now();
		const job = await orchestrator.run();
		const duration = (Date.now() - start) / 1000;
		console.log(`Performance-Test: ${job.htmlFilesGenerated} HTMLs in ${duration}s`);
		expect(duration).toBeLessThan(300);
		expect(job.htmlFilesGenerated).toBeGreaterThan(200);
	});
});
