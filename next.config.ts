import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// NOTE: Keychain resolution is intentionally NOT called here.
// resolveKeychainEnvironment() is invoked at server runtime in:
//   - src/lib/config.ts (loadConfig)
//   - src/lib/monitoring/rollbar-official.ts (server-side init)
// Calling it here would expose secrets during build/config evaluation.

const COMMIT_ENV_VARS = [
	"NEXT_PUBLIC_GIT_COMMIT",
	"VERCEL_GIT_COMMIT_SHA",
	"GITHUB_SHA",
	"CI_COMMIT_SHA",
	"COMMIT_SHA",
] as const;

function toShortCommit(value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	return trimmed.slice(0, 7);
}

function getGitCommit(): string {
	for (const envVar of COMMIT_ENV_VARS) {
		const commit = toShortCommit(process.env[envVar]);
		if (commit) return commit;
	}

	if (!existsSync(path.join(__dirname, ".git"))) {
		return "unknown";
	}

	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: __dirname,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1_000,
		}).trim();
	} catch {
		return "unknown";
	}
}

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "0.1.0",
		NEXT_PUBLIC_GIT_COMMIT: getGitCommit(),
	},
	transpilePackages: ["@mui/material", "@mui/material-nextjs"],
	turbopack: {
		root: path.resolve(__dirname),
	},
};

export default nextConfig;
