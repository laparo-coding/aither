import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3500";

export default defineConfig({
	testDir: "tests/e2e",
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: {
		baseURL,
		headless: true,
		trace: "on-first-retry",
	},
});
