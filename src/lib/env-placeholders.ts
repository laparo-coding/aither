// ---------------------------------------------------------------------------
// Environment Placeholder Detection
// Rejects placeholder sentinel values (e.g. __REQUIRED__) that originate from
// .env.example and must never reach a deployed runtime.
// ---------------------------------------------------------------------------

/**
 * Exact placeholder sentinels used in `.env.example`.
 * A value that matches one of these (after trimming) is never a real secret.
 */
const PLACEHOLDER_SENTINELS = [
	"__REQUIRED__",
	"__DO_NOT_COMMIT_REAL_KEY__",
	"__REQUIRED_GENERATE_FRESH_SECRET__",
	"__REQUIRED_VERCEL_BLOB_TOKEN__",
	"__REQUIRED_CONTEXT7_KEY__",
] as const;

/**
 * Generic pattern for placeholder-like values: `__SOMETHING__`.
 * Catches future sentinels (e.g. `__REQUIRED_NEW_SECRET__`) without needing
 * to keep an exhaustive list. Deliberately requires at least one character
 * between the double underscores on both ends.
 */
const PLACEHOLDER_PATTERN = /^__.+__$/;

/**
 * Legacy example values that are equally never valid credentials.
 */
const LEGACY_EXAMPLE_VALUES = [
	"REPLACE_WITH_YOUR_ASSEMBLY_AI_ENDPOINT",
	"your-production-assemblyai-key",
	"pk_...",
	"sk_...",
] as const;

/**
 * Check whether a single environment value is a placeholder that must be
 * rejected by config validation.
 *
 * @param value - Raw environment variable value (may be undefined).
 * @returns true if the value is a known or pattern-matched placeholder.
 *
 * @example
 * ```ts
 * isPlaceholderValue("__REQUIRED__"); // true
 * isPlaceholderValue("sk_live_...");  // false
 * ```
 */
export function isPlaceholderValue(value: string | undefined): boolean {
	const trimmed = value?.trim();
	if (!trimmed) return false;

	if (PLACEHOLDER_SENTINELS.includes(trimmed as (typeof PLACEHOLDER_SENTINELS)[number])) {
		return true;
	}
	if (PLACEHOLDER_PATTERN.test(trimmed)) {
		return true;
	}
	return LEGACY_EXAMPLE_VALUES.includes(trimmed as (typeof LEGACY_EXAMPLE_VALUES)[number]);
}

/**
 * Find all environment variables whose current value is a placeholder.
 *
 * @param env - Environment record to scan (defaults to `process.env`).
 * @returns Sorted list of variable names holding placeholder values.
 *
 * @example
 * ```ts
 * findPlaceholderEnvVars({ HEMERA_API_KEY: "__REQUIRED__" }); // ["HEMERA_API_KEY"]
 * ```
 */
export function findPlaceholderEnvVars(env: Record<string, string | undefined>): string[] {
	return Object.entries(env)
		.filter(([key, value]) => {
			// Skip Keychain service references — they are pointers, not secrets,
			// and never contain placeholder sentinels by design.
			if (key.endsWith("_KEYCHAIN_SERVICE")) return false;
			return isPlaceholderValue(value);
		})
		.map(([key]) => key)
		.sort();
}

/**
 * Build a descriptive error message for placeholder environment values.
 *
 * @param names - Variable names holding placeholders.
 * @returns Multi-line error message suitable for a thrown Error.
 */
export function placeholderErrorMessage(names: string[]): string {
	const lines = names.map((name) => `  ${name}`);
	return [
		"Environment configuration invalid: placeholder values detected.",
		"The following variables still contain example placeholders (e.g. __REQUIRED__)",
		"from .env.example and must be replaced with real values before startup:",
		...lines,
		"Copy .env.example to .env.local and fill in real credentials.",
		"See .env.example for instructions on how to generate each value.",
	].join("\n");
}
