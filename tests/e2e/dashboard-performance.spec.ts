// ---------------------------------------------------------------------------
// E2E Test: Performance Budget — CLS, FCP
// Task: T020b [US5] — Assert Core Web Vitals budget for dashboard
// ---------------------------------------------------------------------------

import { expect, test } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3500";
const FCP_BUDGET_MS = Number(process.env.E2E_FCP_BUDGET_MS || 1800);

test.describe("Dashboard Performance Budget", () => {
	test("CLS is under 0.1", async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: "networkidle" });
		await page.waitForSelector('[data-testid="steuerung-cards"]', { timeout: 10_000 });

		const cls = await page.evaluate(() => {
			return new Promise<number>((resolve) => {
				let cumulativeScore = 0;
				let quietTimer: ReturnType<typeof setTimeout> | null = null;
				const maxTimer = setTimeout(finish, 5_000);

				function finish() {
					if (quietTimer) clearTimeout(quietTimer);
					clearTimeout(maxTimer);
					observer.disconnect();
					resolve(cumulativeScore);
				}

				function scheduleQuietFinish() {
					if (quietTimer) clearTimeout(quietTimer);
					quietTimer = setTimeout(finish, 500);
				}

				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						// @ts-expect-error layout-shift entries have hadRecentInput
						if (!entry.hadRecentInput) {
							// @ts-expect-error layout-shift entries have value
							cumulativeScore += entry.value;
						}
					}
					scheduleQuietFinish();
				});

				observer.observe({ type: "layout-shift", buffered: true });
				scheduleQuietFinish();
			});
		});

		expect(cls).toBeLessThan(0.1);
	});

	test("FCP is under 1.8 seconds", async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: "networkidle" });

		const fcp = await page.evaluate(() => {
			const entries = performance.getEntriesByName("first-contentful-paint");
			return entries.length > 0 ? entries[0].startTime : -1;
		});

		// Skip if FCP not available (some environments don't report it)
		if (fcp > 0) {
			expect(fcp).toBeLessThan(FCP_BUDGET_MS);
		}
	});
});
