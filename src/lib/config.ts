// ---------------------------------------------------------------------------
// Environment Configuration Loader
// Task: T017 — Validate all env vars at startup using Zod
// ---------------------------------------------------------------------------
//
// Recommended flag values per environment:
//
// ┌──────────────────────────────┬──────────┬──────────┬──────────┐
// │ Flag                         │ Local    │ CI/Test  │ Prod     │
// ├──────────────────────────────┼──────────┼──────────┼──────────┤
// │ ROLLBAR_ENABLED              │ 1        │ 0        │ 1        │
// │ NEXT_PUBLIC_ROLLBAR_ENABLED  │ 1        │ 0        │ 1        │
// │ E2E_TEST                     │ 0        │ 1        │ 0        │
// │ NEXT_PUBLIC_TELEMETRY_CONSENT│ 0        │ 0        │ 0 *      │
// │ ROLLBAR_ALLOW_PII            │ 0        │ 0        │ 0 *      │
// │ ROLLBAR_SAMPLE_RATE_INFO     │ 1        │ —        │ 0.05     │
// │ ROLLBAR_SAMPLE_RATE_WARN     │ 1        │ —        │ 0.05     │
// │ ROLLBAR_SAMPLE_RATE_ERROR    │ 1        │ —        │ 1        │
// │ ROLLBAR_SAMPLE_RATE_CRITICAL │ 1        │ —        │ 1        │
// └──────────────────────────────┴──────────┴──────────┴──────────┘
// * Set to 1 only with explicit user consent (GDPR/DSG).
// — Not applicable (Rollbar is disabled in CI).
//
// See .env.example for full documentation of each variable.
// ---------------------------------------------------------------------------

import { z } from "zod";

// Email used in documentation and error messages for the configured service user
export const SERVICE_USER_EMAIL = "aither-service@hemera-academy.com";

/**
 * Coerce environment variable strings to booleans for use in Zod schemas.
 *
 * Truthy values: `"1"`, `1`, `true`, `"true"`
 * Falsy values:  everything else (`"0"`, `0`, `""`, `undefined`, `"false"`, etc.)
 *
 * @param defaultValue - The default when the env var is not set.
 *
 * @example
 * ```ts
 * const Schema = z.object({
 *   FEATURE_ENABLED: envBool(true),   // default: true  → "1" or "true" to enable
 *   DEBUG_MODE:      envBool(false),  // default: false → set "1" to enable
 * });
 * ```
 *
 * @remarks
 * - Use for all boolean-like env flags (e.g. ROLLBAR_ENABLED, E2E_TEST).
 * - Do NOT use for numeric values (use `z.coerce.number()` instead).
 * - The resulting `AppConfig` type will be `boolean`, not `string`.
 */
const envBool = (defaultValue: boolean) =>
	z
		.preprocess((v) => {
			if (v == null) return v;
			if (v === "1" || v === 1 || v === true || v === "true") return true;
			if (v === "0" || v === 0 || v === false || v === "false") return false;
			return v;
		}, z.boolean())
		.default(defaultValue);

const EnvSchema = z
	.object({
		// Hemera Academy API
		// Base URL must include the full origin (e.g. https://hemera-academy.vercel.app)
		HEMERA_API_BASE_URL: z.string().url(),
		// Fallback URL for hybrid setups (e.g., container + network access)
		HEMERA_API_FALLBACK_URL: z.string().url().optional(),
		// API key for service-to-service authentication (min 32 chars)
		HEMERA_API_KEY: z.string().min(32, "HEMERA_API_KEY must be at least 32 characters"),

		// Context7 API key (optional) — use secret key starting with ctx7sk_ or ctx7sk-
		CONTEXT7_API_KEY: z
			.string()
			.optional()
			.refine((v) => !v || v.startsWith("ctx7sk_") || v.startsWith("ctx7sk-"), {
				message: "CONTEXT7_API_KEY must start with 'ctx7sk_' or 'ctx7sk-'",
			}),

		// Clerk Authentication
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
		CLERK_SECRET_KEY: z.string().min(1),
		CLERK_SERVICE_USER_ID: z.string().min(1),
		CLERK_SERVICE_USER_EMAIL: z.string().email().optional(),

		// SMTP Notifications
		SMTP_HOST: z.string().min(1),
		SMTP_PORT: z.coerce.number().int().positive().default(587),
		SMTP_USER: z.string().min(1),
		SMTP_PASS: z.string().min(1),
		SMTP_FROM: z.string().email(),
		SMTP_SECURE: envBool(false).optional(),
		NOTIFY_EMAIL_TO: z.string().email(),
		NOTIFY_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),

		// Rollbar — server & client tokens
		ROLLBAR_SERVER_TOKEN: z.string().default(""),
		NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN: z.string().default(""),
		// Rollbar MCP/AI tools — prefer read-only token for automation
		ROLLBAR_ACCESS_TOKEN: z
			.string()
			.default("")
			.describe("Optional write token for Rollbar; prefer read-only token when possible."),
		ROLLBAR_ACCESS_TOKEN_READONLY: z
			.string()
			.default("")
			.describe("Preferred read-only token for Rollbar automation"),

		// Rollbar control flags
		NEXT_PUBLIC_ROLLBAR_ENABLED: envBool(true),
		ROLLBAR_ENABLED: envBool(true),

		// Rollbar sampling rates (0.0–1.0)
		ROLLBAR_SAMPLE_RATE_ALL: z.coerce.number().min(0).max(1).default(1),
		ROLLBAR_SAMPLE_RATE_INFO: z.coerce.number().min(0).max(1).default(0.05),
		ROLLBAR_SAMPLE_RATE_WARN: z.coerce.number().min(0).max(1).default(0.05),
		ROLLBAR_SAMPLE_RATE_ERROR: z.coerce.number().min(0).max(1).default(1),
		ROLLBAR_SAMPLE_RATE_CRITICAL: z.coerce.number().min(0).max(1).default(1),

		// Privacy
		NEXT_PUBLIC_TELEMETRY_CONSENT: envBool(false),
		TELEMETRY_CONSENT: envBool(false),
		ROLLBAR_ALLOW_PII: envBool(false),

		// E2E Testing
		E2E_TEST: envBool(false),

		// Postman MCP
		POSTMAN_API_KEY: z.string().min(1),

		// Output
		HTML_OUTPUT_DIR: z.string().min(1).default("output"),
		SLIDES_OUTPUT_DIR: z.string().min(1).default("output/slides"),
		RECORDINGS_OUTPUT_DIR: z.string().min(1).default("output/recordings"),

		// Recording — webcam stream URL (required for recording, not at boot)
		WEBCAM_STREAM_URL: z.string().optional(),

		// MUX — video upload (optional, US6 only)
		MUX_TOKEN_ID: z.string().optional(),
		MUX_TOKEN_SECRET: z.string().optional(),

		// Vercel Blob Storage — ffmetadata sidecar (Spec 009, optional at boot)
		BLOB_READ_WRITE_TOKEN: z.string().optional(),

		// Uranos service token — timestamp endpoint auth (Spec 009, optional at boot)
		URANOS_SYNC_TOKEN: z
			.string()
			.optional()
			.refine((val) => val === undefined || val.length >= 32, {
				message: "URANOS_SYNC_TOKEN must be at least 32 characters when provided",
			}),

		// Notification recipient (distinct from SMTP_FROM)
		SMTP_TO: z.string().email().optional(),
	})
	// Rollbar token validation: require token if enabled
	.refine((env) => !env.ROLLBAR_ENABLED || env.ROLLBAR_SERVER_TOKEN.length > 0, {
		message: "ROLLBAR_SERVER_TOKEN required when ROLLBAR_ENABLED=true",
		path: ["ROLLBAR_SERVER_TOKEN"],
	})
	.refine(
		(env) => !env.NEXT_PUBLIC_ROLLBAR_ENABLED || env.NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN.length > 0,
		{
			message: "NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN required when NEXT_PUBLIC_ROLLBAR_ENABLED=true",
			path: ["NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN"],
		},
	);

export type AppConfig = z.infer<typeof EnvSchema>;

let _config: AppConfig | null = null;

/**
 * Load and validate environment configuration.
 * Throws a descriptive error if any required env var is missing or invalid.
 * Result is cached after first successful load.
 */
export function loadConfig(): AppConfig {
	if (_config) return _config;

	const result = EnvSchema.safeParse(process.env);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new Error(`Environment configuration invalid:\n${issues}`);
	}

	_config = result.data;
	return _config;
}

/** Reset cached config (for testing). */
export function resetConfig(): void {
	_config = null;
}

/**
 * @deprecated Use `loadConfig()` instead. This alias exists only for
 * backward compatibility and will be removed in a future release.
 */
export const getConfig = loadConfig;
