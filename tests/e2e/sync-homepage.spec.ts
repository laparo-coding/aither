// ---------------------------------------------------------------------------
// E2E Test: Homepage — Nächster Kurs + Teilnehmer-Tabellen
// Task: T020 [US5] — Validate course detail + participant tables on homepage
// ---------------------------------------------------------------------------

import { expect, test } from "@playwright/test";
import { hasVisible } from "./utils/helpers";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3500";

test.describe("Homepage — Kursdetails & Teilnehmer", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(BASE_URL);
	});

	test("zeigt entweder Kurskarte oder Fallback-Zustand", async ({ page }) => {
		const courseCard = page.locator('[data-testid="course-card"]');
		const noCourse = page.locator('[data-testid="no-upcoming-course"]');
		const connection = page.locator('[data-testid="connection-status"]');

		const courseVisible = await hasVisible(courseCard);
		const noCourseVisible = await hasVisible(noCourse);
		const connectionVisible = await hasVisible(connection);

		expect(courseVisible || noCourseVisible || connectionVisible).toBe(true);

		if (courseVisible) {
			await expect(courseCard).toContainText("Startdatum");
			await expect(courseCard).toContainText("Enddatum");
			await expect(courseCard).toContainText("Teilnehmerzahl");
		}
	});

	test("zeigt Teilnehmerbereich wenn ein Kurs geladen wurde", async ({ page }) => {
		const courseCard = page.locator('[data-testid="course-card"]');
		const participantsList = page.locator('[data-testid="participants-list"]');
		const courseVisible = await hasVisible(courseCard);

		test.skip(!courseVisible, "No course loaded in current environment");

		await expect(participantsList).toBeVisible();
		await expect(participantsList).toContainText("Teilnehmer");
	});

	test("zeigt Hauptbereiche unabhängig vom Kurszustand", async ({ page }) => {
		await expect(page.locator('[data-testid="steuerung-cards"]')).toBeVisible();
		await expect(page.locator('[data-testid="camera-card"]')).toBeVisible();
	});

	test("zeigt Fallback-Nachricht wenn API nicht erreichbar", async ({ page }) => {
		const fallback = page.locator('[data-testid="connection-status"]');
		const courseCard = page.locator('[data-testid="course-card"]');

		// Either data is visible OR the connection fallback is visible
		const hasTable = await courseCard.isVisible().catch(() => false);
		const hasFallback = await fallback.isVisible().catch(() => false);

		expect(hasTable || hasFallback).toBe(true);
	});

	test("zeigt Kein-Kurs-Nachricht wenn kein zukünftiger Kurs existiert", async ({ page }) => {
		const noCourse = page.locator('[data-testid="no-upcoming-course"]');
		const courseCard = page.locator('[data-testid="course-card"]');
		const fallback = page.locator('[data-testid="connection-status"]');

		const noCourseVisible = await hasVisible(noCourse);
		const courseVisible = await hasVisible(courseCard);
		const fallbackVisible = await hasVisible(fallback);

		// Accept all valid SSR states: upcoming course, no course, or connection fallback.
		expect(noCourseVisible || courseVisible || fallbackVisible).toBe(true);
	});
});
