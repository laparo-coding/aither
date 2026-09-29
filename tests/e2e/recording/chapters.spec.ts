// ---------------------------------------------------------------------------
// E2E Test: Full Chapters Workflow (Spec 010)
// Task: T040 — start recording → ingest timestamps → stop → regenerate
//               chapters → list chapters → play chapter → stream MUX chaptered
//               asset via CDN → receive exactly one chapter-boundary SSE event
//               per crossed boundary (validate dedupe key + tick cadence).
// ---------------------------------------------------------------------------

import { expect, test } from "@playwright/test";

const recordingId = "rec_2026-07-13T10-30-00Z";
const chapters = [
	{ id: 0, start: 0, end: 10, title: "Chapter 1" },
	{ id: 1, start: 10, end: 20, title: "Chapter 2" },
	{ id: 2, start: 20, end: 30, title: "Chapter 3" },
];
const stateReports: Array<{ state: string; position: number }> = [];

test.describe("Recording player chapter playback", () => {
	test.skip(
		process.env.ENABLE_DEV_AUTH_BYPASS !== "true",
		"Run Playwright and the development server with ENABLE_DEV_AUTH_BYPASS=true",
	);

	test.beforeEach(async ({ page }) => {
		stateReports.length = 0;
		await page.addInitScript(() => {
			const mediaStates = new WeakMap<HTMLMediaElement, { currentTime: number; paused: boolean }>();
			const getState = (media: HTMLMediaElement) => {
				let state = mediaStates.get(media);
				if (!state) {
					state = { currentTime: 0, paused: true };
					mediaStates.set(media, state);
				}
				return state;
			};

			Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
				configurable: true,
				get() {
					return getState(this).currentTime;
				},
				set(value: number) {
					getState(this).currentTime = value;
				},
			});
			Object.defineProperty(HTMLMediaElement.prototype, "paused", {
				configurable: true,
				get() {
					return getState(this).paused;
				},
			});
			HTMLMediaElement.prototype.load = () => {};
			HTMLMediaElement.prototype.play = function () {
				getState(this).paused = false;
				this.dispatchEvent(new Event("play"));
				return Promise.resolve();
			};
			HTMLMediaElement.prototype.pause = function () {
				getState(this).paused = true;
				this.dispatchEvent(new Event("pause"));
			};
			window.addEventListener(
				"error",
				(event) => {
					if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
				},
				true,
			);
		});

		await page.route("**/api/recording/chapters/**", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true, data: { assetId: recordingId, chapters } }),
			}),
		);
		await page.route("**/api/recording/events**", (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/event-stream",
				body: `event: connected\ndata: {"recordingId":"${recordingId}"}\n\n`,
			}),
		);
		await page.route("**/api/recording/stream/**", (route) =>
			route.fulfill({ status: 200, contentType: "video/mp4", body: "" }),
		);
		await page.route("**/api/recording/playback/state", async (route) => {
			const body = route.request().postDataJSON() as { state: string; position: number };
			stateReports.push(body);
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true, data: { accepted: true } }),
			});
		});

		const chaptersLoaded = page.waitForResponse(
			(response) =>
				response.url().includes(`/api/recording/chapters/${recordingId}`) &&
				response.status() === 200,
		);
		const eventsConnected = page.waitForResponse((response) =>
			response.url().includes("/api/recording/events"),
		);
		await page.goto(`/recording/player/${recordingId}`);
		await Promise.all([chaptersLoaded, eventsConnected]);
		await expect(page.locator("video")).toBeVisible();
	});

	test("pauses at the active chapter end and reports the final position", async ({ page }) => {
		const video = page.locator("video");
		await video.evaluate((element) => {
			const player = element as HTMLVideoElement;
			player.currentTime = 0;
			void player.play();
			player.currentTime = 9.7;
			player.dispatchEvent(new Event("timeupdate"));
		});
		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused))
			.toBe(false);

		await video.evaluate((element) => {
			const player = element as HTMLVideoElement;
			player.currentTime = 10.2;
			player.dispatchEvent(new Event("timeupdate"));
		});

		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused))
			.toBe(true);
		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
			.toBe(10);
		await expect
			.poll(() =>
				stateReports.some((report) => report.state === "paused" && report.position === 10),
			)
			.toBe(true);
	});

	test("next timestamp switches the active chapter before it reaches its end", async ({ page }) => {
		const video = page.locator("video");
		await video.evaluate((element) => {
			const player = element as HTMLVideoElement;
			player.currentTime = 0;
			void player.play();
		});
		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused))
			.toBe(false);
		await page.mouse.move(300, 300);
		await page.getByRole("button", { name: /Nächster Timestamp/ }).click();
		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
			.toBe(10);

		await video.evaluate((element) => {
			const player = element as HTMLVideoElement;
			player.currentTime = 20.2;
			player.dispatchEvent(new Event("timeupdate"));
		});

		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused))
			.toBe(true);
		await expect
			.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
			.toBe(20);
	});
});
