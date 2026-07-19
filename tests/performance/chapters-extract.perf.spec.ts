// ---------------------------------------------------------------------------
// Performance Test: ffprobe Chapter Extraction Latency (Spec 010)
// Task: T051 — Benchmark p95 < 500ms for ffprobe chapter extraction on MUX URL
//               (20 iterations per file size).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { extractChapters } from "@/lib/recording/chapter-extractor";

describe("Performance: ffprobe extraction p95 (T051)", () => {
	const hasPerfEnv = Boolean(process.env.PERF_TEST_MUX_URL);

	it.skipIf(!hasPerfEnv)("p95 ffprobe extraction < 500ms on MUX URL", async () => {
		const muxPlaybackUrl = process.env.PERF_TEST_MUX_URL as string;
		const times: number[] = [];

		for (let i = 0; i < 20; i++) {
			const start = Date.now();
			await extractChapters("perf-rec", muxPlaybackUrl);
			times.push(Date.now() - start);
		}

		const sorted = [...times].sort((a, b) => a - b);
		const p95Index = Math.ceil(sorted.length * 0.95) - 1;
		const p95 = sorted[Math.max(0, p95Index)];

		expect(p95).toBeLessThan(500);
	});
});
