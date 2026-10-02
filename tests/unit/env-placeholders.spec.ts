// ---------------------------------------------------------------------------
// Unit Tests: Environment Placeholder Detection
// Ensures config validation rejects placeholder sentinels from .env.example
// (e.g. __REQUIRED__, __DO_NOT_COMMIT_REAL_KEY__) instead of treating them
// as configured values.
// ---------------------------------------------------------------------------

import {
	findPlaceholderEnvVars,
	isPlaceholderValue,
	placeholderErrorMessage,
} from "@/lib/env-placeholders";
import { describe, expect, it } from "vitest";

describe("isPlaceholderValue", () => {
	it("rejects the documented sentinel values", () => {
		expect(isPlaceholderValue("__REQUIRED__")).toBe(true);
		expect(isPlaceholderValue("__DO_NOT_COMMIT_REAL_KEY__")).toBe(true);
		expect(isPlaceholderValue("__REQUIRED_GENERATE_FRESH_SECRET__")).toBe(true);
		expect(isPlaceholderValue("__REQUIRED_VERCEL_BLOB_TOKEN__")).toBe(true);
		expect(isPlaceholderValue("__REQUIRED_CONTEXT7_KEY__")).toBe(true);
	});

	it("rejects future sentinels matching the __...__ pattern", () => {
		expect(isPlaceholderValue("__REQUIRED_NEW_SECRET__")).toBe(true);
		expect(isPlaceholderValue("__TODO__")).toBe(true);
	});

	it("rejects legacy example values", () => {
		expect(isPlaceholderValue("REPLACE_WITH_YOUR_ASSEMBLY_AI_ENDPOINT")).toBe(true);
		expect(isPlaceholderValue("your-production-assemblyai-key")).toBe(true);
		expect(isPlaceholderValue("pk_...")).toBe(true);
		expect(isPlaceholderValue("sk_...")).toBe(true);
	});

	it("trims surrounding whitespace before matching", () => {
		expect(isPlaceholderValue("  __REQUIRED__  ")).toBe(true);
		expect(isPlaceholderValue("\t__REQUIRED__\n")).toBe(true);
	});

	it("accepts real credentials", () => {
		expect(isPlaceholderValue("sk_live_abc123")).toBe(false);
		expect(isPlaceholderValue("pk_test_abc123")).toBe(false);
		expect(isPlaceholderValue("ZXhhbXBsZS1rZXktcmVwbGFjZS1tZS13aXRoLXJlYWw")).toBe(false);
		expect(isPlaceholderValue("vercel_blob_rw_example_token")).toBe(false);
		expect(isPlaceholderValue("https://api.assemblyai.com")).toBe(false);
	});

	it("treats empty and undefined as not placeholders", () => {
		expect(isPlaceholderValue(undefined)).toBe(false);
		expect(isPlaceholderValue("")).toBe(false);
		expect(isPlaceholderValue("   ")).toBe(false);
	});

	it("does not flag values with only leading or trailing underscores", () => {
		expect(isPlaceholderValue("_REQUIRED_")).toBe(false);
		expect(isPlaceholderValue("__REQUIRED")).toBe(false);
		expect(isPlaceholderValue("REQUIRED__")).toBe(false);
	});
});

describe("findPlaceholderEnvVars", () => {
	it("returns sorted variable names holding placeholders", () => {
		const result = findPlaceholderEnvVars({
			HEMERA_API_KEY: "__REQUIRED__",
			CLERK_SECRET_KEY: "sk_live_real",
			MUX_SIGNING_KEY_PRIVATE_KEY: "__DO_NOT_COMMIT_REAL_KEY__",
		});

		expect(result).toEqual(["HEMERA_API_KEY", "MUX_SIGNING_KEY_PRIVATE_KEY"]);
	});

	it("ignores Keychain service references", () => {
		const result = findPlaceholderEnvVars({
			HEMERA_API_KEY_KEYCHAIN_SERVICE: "hemera-api-key",
			ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE: "assemblyai-aither-api-key",
		});

		expect(result).toEqual([]);
	});

	it("returns an empty list for a fully configured environment", () => {
		const result = findPlaceholderEnvVars({
			HEMERA_API_KEY: "a".repeat(43),
			CLERK_SECRET_KEY: "sk_live_real",
			SMTP_PASS: "real-password",
		});

		expect(result).toEqual([]);
	});
});

describe("placeholderErrorMessage", () => {
	it("lists all affected variables with guidance", () => {
		const message = placeholderErrorMessage(["HEMERA_API_KEY", "SMTP_PASS"]);

		expect(message).toContain("placeholder values detected");
		expect(message).toContain("HEMERA_API_KEY");
		expect(message).toContain("SMTP_PASS");
		expect(message).toContain(".env.example");
	});

	it("mentions the copy-to-.env.local workflow", () => {
		const message = placeholderErrorMessage(["CLERK_SECRET_KEY"]);

		expect(message).toContain(".env.local");
	});
});
