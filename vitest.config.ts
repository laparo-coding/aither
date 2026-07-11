import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		globals: true,
		// Default to Node; browser-like tests opt in with per-file @vitest-environment jsdom.
		environment: "node",
		include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
		exclude: ["tests/e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "clover"],
			reportsDirectory: "coverage",
			include: ["src/lib/**/*.ts"],
			exclude: ["src/lib/**/*.d.ts"],
		},
	},
});
