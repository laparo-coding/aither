// ---------------------------------------------------------------------------
// Integration Tests: loadConfig() placeholder rejection
// Ensures loadConfig() fails fast when env vars contain placeholder sentinels
// from .env.example instead of starting with bogus credentials.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Valid baseline environment — every required variable properly configured.
// Tests mutate a single variable to a placeholder to verify rejection.
const VALID_BASE_ENV: Record<string, string> = {
	HEMERA_API_BASE_URL: "https://hemera-academy.vercel.app",
	HEMERA_API_KEY: "a".repeat(43),
	NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_valid",
	CLERK_SECRET_KEY: "sk_live_valid",
	CLERK_SERVICE_USER_ID: "user_valid",
	SMTP_HOST: "smtp.example.com",
	SMTP_USER: "user@example.com",
	SMTP_PASS: "real-password",
	SMTP_FROM: "noreply@example.com",
	NOTIFY_EMAIL_TO: "ops@example.com",
	POSTMAN_API_KEY: "real-postman-key",
	ROLLBAR_SERVER_TOKEN: "",
	NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN: "",
	ROLLBAR_ENABLED: "0",
	NEXT_PUBLIC_ROLLBAR_ENABLED: "0",
};

/** Snapshot of the real process.env keys relevant to the schema. */
const MANAGED_KEYS = new Set([
	...Object.keys(VALID_BASE_ENV),
	"HEMERA_API_FALLBACK_URL",
	"HEMERA_API_KEY_KEYCHAIN_SERVICE",
	"CLERK_SERVICE_USER_EMAIL",
	"SMTP_SECURE",
	"CONTEXT7_API_KEY",
	"WEBCAM_STREAM_URL",
	"MUX_TOKEN_ID",
	"MUX_TOKEN_SECRET",
	"BLOB_READ_WRITE_TOKEN",
	"BLOB_READ_WRITE_TIMESTAMP_TOKEN",
	"URANOS_SYNC_TOKEN",
	"SMTP_TO",
	"ASSEMBLY_AI_BASE_URL",
	"ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE",
	"ASSEMBLY_AI_API_KEY",
	"ASSEMBLY_AI_WEBHOOK_SECRET",
	"AITHER_SYNC_TOKEN",
	"MUX_SIGNING_KEY_ID",
	"MUX_SIGNING_KEY_PRIVATE_KEY",
	"AITHER_SERVICE_KEY",
]);

function applyEnv(env: Record<string, string | undefined>): void {
	for (const key of MANAGED_KEYS) {
		const value = env[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("loadConfig placeholder rejection", () => {
	let loadConfig: typeof import("@/lib/config").loadConfig;
	let resetConfig: typeof import("@/lib/config").resetConfig;

	beforeEach(async () => {
		vi.resetModules();
		applyEnv(VALID_BASE_ENV);
		const configModule = await import("@/lib/config");
		loadConfig = configModule.loadConfig;
		resetConfig = configModule.resetConfig;
		resetConfig();
	});

	it("accepts a fully configured environment", () => {
		expect(() => loadConfig()).not.toThrow();
	});

	it("rejects __REQUIRED__ in a required variable", () => {
		process.env.HEMERA_API_KEY = "__REQUIRED__";

		expect(() => loadConfig()).toThrow(/placeholder values detected[\s\S]*HEMERA_API_KEY/);
	});

	it("rejects __DO_NOT_COMMIT_REAL_KEY__ in an optional variable", () => {
		process.env.MUX_SIGNING_KEY_PRIVATE_KEY = "__DO_NOT_COMMIT_REAL_KEY__";

		expect(() => loadConfig()).toThrow(/MUX_SIGNING_KEY_PRIVATE_KEY/);
	});

	it("rejects __REQUIRED_GENERATE_FRESH_SECRET__ in an optional variable", () => {
		process.env.ASSEMBLY_AI_WEBHOOK_SECRET = "__REQUIRED_GENERATE_FRESH_SECRET__";

		expect(() => loadConfig()).toThrow(/ASSEMBLY_AI_WEBHOOK_SECRET/);
	});

	it("rejects placeholders even when they would pass length checks", () => {
		// 33 chars — passes the schema's min(16) but must still be rejected.
		process.env.ASSEMBLY_AI_WEBHOOK_SECRET = "__REQUIRED_GENERATE_FRESH_SECRET__";

		expect(() => loadConfig()).toThrow(/placeholder values detected/);
	});

	it("rejects unknown future sentinels matching the __...__ pattern", () => {
		process.env.CLERK_SECRET_KEY = "__REQUIRED_NEW_FORMAT__";

		expect(() => loadConfig()).toThrow(/CLERK_SECRET_KEY/);
	});

	it("rejects legacy example values", () => {
		process.env.ASSEMBLY_AI_BASE_URL = "REPLACE_WITH_YOUR_ASSEMBLY_AI_ENDPOINT";

		expect(() => loadConfig()).toThrow(/ASSEMBLY_AI_BASE_URL/);
	});

	it("lists every affected variable in the error message", () => {
		process.env.HEMERA_API_KEY = "__REQUIRED__";
		process.env.SMTP_PASS = "__REQUIRED__";

		try {
			loadConfig();
			throw new Error("expected loadConfig to throw");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			expect(message).toContain("HEMERA_API_KEY");
			expect(message).toContain("SMTP_PASS");
		}
	});

	it("does not reject Keychain service references", () => {
		process.env.HEMERA_API_KEY_KEYCHAIN_SERVICE = "hemera-api-key";
		// biome-ignore lint/performance/noDelete: must fully remove the key so the Keychain reference resolves it
		delete process.env.HEMERA_API_KEY;

		// Keychain resolution runs on macOS; on other platforms the schema
		// rejects the missing key — but never with a placeholder error.
		let threw: Error | null = null;
		try {
			loadConfig();
		} catch (err) {
			threw = err instanceof Error ? err : new Error(String(err));
		}

		if (threw) {
			expect(threw.message).not.toContain("placeholder values detected");
		} else {
			// On macOS the Keychain resolves the secret and the config loads.
			expect(threw).toBeNull();
		}
	});
});
