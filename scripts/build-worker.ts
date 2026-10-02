/**
 * Worker Build Script
 *
 * Compiles the transcription worker from TypeScript to JavaScript for production use.
 * This ensures the worker runs as compiled JS (not via tsx) in production,
 * reducing attack surface and following security best practices.
 *
 * Usage:
 *   npx tsx scripts/build-worker.ts          # Development
 *   node dist/scripts/build-worker.js         # Production (after initial build)
 *
 * Security: Production workers MUST run compiled JS, not tsx.
 * See: https://github.com/laparo-coding/aither/security/audit
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIST_DIR = join(ROOT, "dist");
const WORKER_SRC = join(ROOT, "scripts/transcription-worker.ts");
const WORKER_DIST = join(DIST_DIR, "scripts/transcription-worker.js");

function log(message: string): void {
	console.log(`[build-worker] ${message}`);
}

function buildWorker(): void {
	// Ensure dist directory exists
	if (!existsSync(DIST_DIR)) {
		mkdirSync(DIST_DIR, { recursive: true });
		log("Created dist directory");
	}

	// Compile worker using esbuild with bundling and project tsconfig for @/ alias resolution
	log(`Bundling ${WORKER_SRC} → ${WORKER_DIST}`);

	try {
		execSync(
			`npx esbuild "${WORKER_SRC}" --bundle --platform=node --target=node20 --format=cjs --outfile="${WORKER_DIST}" --packages=external --tsconfig=tsconfig.json`,
			{
				cwd: ROOT,
				stdio: "inherit",
			},
		);
		log("Worker bundled successfully");
	} catch (error) {
		console.error("[build-worker] Compilation failed:", error);
		process.exit(1);
	}
}

// Run build
buildWorker();
