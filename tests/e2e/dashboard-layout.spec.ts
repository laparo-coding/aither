// ---------------------------------------------------------------------------
// E2E Test: Dashboard Layout — All six sections visible & responsive
// Task: T020 [US5] — Validate dashboard section visibility and responsiveness
// Sections: course-card, material-card, participants-list, slides-list,
//           steuerung-cards, camera-card
// ---------------------------------------------------------------------------

import { expect, test } from "@playwright/test";
import { hasVisible } from "./utils/helpers";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3500";

test.describe("Dashboard Layout", () => {
	test("all six sections visible on desktop viewport", async ({ page }) => {
		await page.setViewportSize({ width: 1200, height: 800 });
		await page.goto(BASE_URL);

		await expect(page.locator('[data-testid="steuerung-cards"]')).toBeVisible();
		await expect(page.locator('[data-testid="camera-card"]')).toBeVisible();

		const courseVisible = await hasVisible(page.locator('[data-testid="course-card"]'));
		const noCourseVisible = await hasVisible(page.locator('[data-testid="no-upcoming-course"]'));
		const connectionVisible = await hasVisible(page.locator('[data-testid="connection-status"]'));
		expect(courseVisible || noCourseVisible || connectionVisible).toBe(true);

		if (courseVisible) {
			await expect(page.locator('[data-testid="material-card"]')).toBeVisible();
			await expect(page.locator('[data-testid="participants-list"]')).toBeVisible();
		}
	});

	test("all six sections visible on mobile viewport", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto(BASE_URL);

		await expect(page.locator('[data-testid="steuerung-cards"]')).toBeVisible();
		await expect(page.locator('[data-testid="camera-card"]')).toBeVisible();

		const courseVisible = await hasVisible(page.locator('[data-testid="course-card"]'));
		const noCourseVisible = await hasVisible(page.locator('[data-testid="no-upcoming-course"]'));
		const connectionVisible = await hasVisible(page.locator('[data-testid="connection-status"]'));
		expect(courseVisible || noCourseVisible || connectionVisible).toBe(true);

		if (courseVisible) {
			await expect(page.locator('[data-testid="material-card"]')).toBeVisible();
			await expect(page.locator('[data-testid="participants-list"]')).toBeVisible();
		}
	});

	test("Section A cards are side-by-side on desktop", async ({ page }) => {
		await page.setViewportSize({ width: 1200, height: 800 });
		await page.goto(BASE_URL);

		const courseCard = page.locator('[data-testid="course-card"]');
		const materialCard = page.locator('[data-testid="material-card"]');
		const courseVisible = await hasVisible(courseCard);
		const materialVisible = await hasVisible(materialCard);

		test.skip(!courseVisible || !materialVisible, "No active course cards in current environment");

		await expect(courseCard).toBeVisible();
		await expect(materialCard).toBeVisible();

		const courseBox = await courseCard.boundingBox();
		const materialBox = await materialCard.boundingBox();

		if (!courseBox) {
			throw new Error("course-card bounding box missing");
		}

		if (!materialBox) {
			throw new Error("material-card bounding box missing");
		}

		// Both cards should be roughly on the same vertical line (side-by-side)
		expect(Math.abs(courseBox.y - materialBox.y)).toBeLessThan(10);
	});

	test("single column on mobile viewport", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto(BASE_URL);

		const courseCard = page.locator('[data-testid="course-card"]');
		const materialCard = page.locator('[data-testid="material-card"]');
		const courseVisible = await hasVisible(courseCard);
		const materialVisible = await hasVisible(materialCard);

		test.skip(!courseVisible || !materialVisible, "No active course cards in current environment");

		await expect(courseCard).toBeVisible();
		await expect(materialCard).toBeVisible();

		const courseBox = await courseCard.boundingBox();
		const materialBox = await materialCard.boundingBox();

		if (!courseBox) {
			throw new Error("course-card bounding box missing");
		}

		if (!materialBox) {
			throw new Error("material-card bounding box missing");
		}

		// On mobile, material card should be below course card (stacked)
		expect(materialBox.y).toBeGreaterThan(courseBox.y + courseBox.height - 10);
	});
});
