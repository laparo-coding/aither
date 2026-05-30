// ---------------------------------------------------------------------------
// Rollbar Configuration — following hemera's official pattern
// Singleton instance with environment detection, test/E2E no-op, PII filtering,
// sampling rates, and structured error reporting.
// ---------------------------------------------------------------------------

import Rollbar from "rollbar";
import { isTelemetryConsentGranted } from "./privacy";

interface RollbarTestInstance {
	critical: () => void;
	error: () => void;
	warning: () => void;
	warn: () => void;
	info: () => void;
	debug: () => void;
	log: () => void;
	wait: (cb?: () => void) => void;
}

const noopInstance: RollbarTestInstance = {
	critical: () => {},
	error: () => {},
	warning: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	log: () => {},
	wait: (cb?: () => void) => {
		if (typeof cb === "function") cb();
	},
};

// ── Enablement rules ──────────────────────────────────────────────────────

const isE2EMode = process.env.E2E_TEST === "1";
const isTestMode =
	process.env.NODE_ENV === "test" ||
	// Vitest uses VITEST, VITEST_POOL_ID; Jest uses JEST_WORKER_ID
	typeof process.env.VITEST !== "undefined" ||
	typeof process.env.JEST_WORKER_ID !== "undefined";
const isNodeRuntime = process.env.NEXT_RUNTIME !== "edge" && typeof window === "undefined";
const isDevelopment = process.env.NODE_ENV === "development";
const isServerExplicitlyDisabled = process.env.ROLLBAR_ENABLED === "0";
const isClientExplicitlyDisabled =
	process.env.NEXT_PUBLIC_ROLLBAR_ENABLED === "0" || isServerExplicitlyDisabled;
const rollbarServerRoot = process.env.ROLLBAR_SERVER_ROOT;
const clientRollbarToken = process.env.NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN;

const COMMON_SCRUB_FIELDS = [
	"password",
	"apiKey",
	"api_key",
	"secret",
	"token",
	"authorization",
] satisfies string[];

const CLIENT_SCRUB_FIELDS = [
	...COMMON_SCRUB_FIELDS,
	"cookie",
	"cookies",
	"set-cookie",
	"email",
	"user_email",
	"userEmail",
	"user_id",
	"userId",
	"user_ip",
	"ip",
	"ip_address",
	"person",
	"clerk",
	"session",
	"sessionId",
	"session_id",
	"accessToken",
	"refreshToken",
] satisfies string[];

export function isExplicitlyEnabled(name: string): boolean {
	const value = process.env[name];
	return value === "1" || value === "true";
}

function redactSensitiveFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSensitiveFields);
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	const sensitiveKeys = new Set(CLIENT_SCRUB_FIELDS.map((field) => field.toLowerCase()));
	const input = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};

	for (const [key, nestedValue] of Object.entries(input)) {
		output[key] = sensitiveKeys.has(key.toLowerCase())
			? "[redacted]"
			: redactSensitiveFields(nestedValue);
	}

	return output;
}

export function transformClientPayload(payload: Record<string, unknown>): void {
	const data = payload.data;
	if (!data || typeof data !== "object") {
		return;
	}

	const dataRecord = data as Record<string, unknown>;
	const body = dataRecord.body;
	if (!body || typeof body !== "object") {
		return;
	}

	const bodyRecord = body as Record<string, unknown>;
	const transformedBody = redactSensitiveFields(bodyRecord) as Record<string, unknown>;
	transformedBody.person = undefined;

	const request = transformedBody.request;
	if (request && typeof request === "object") {
		const requestRecord = request as Record<string, unknown>;
		requestRecord.user_ip = undefined;
		requestRecord.headers = undefined;
	}

	dataRecord.body = transformedBody;
}

interface ClientRollbarEnablementOptions {
	isNodeRuntime: boolean;
	isTestMode: boolean;
	isE2EMode: boolean;
	isExplicitlyDisabled: boolean;
	publicEnabled: boolean;
	clientToken?: string;
}

interface ServerRootOptions {
	isNodeRuntime: boolean;
	configuredRoot?: string;
	getCwd?: () => string;
}

function readProcessCwdSafe(): string {
	const maybeProcess = (globalThis as { process?: { cwd?: () => string } }).process;
	if (typeof maybeProcess?.cwd !== "function") {
		return "";
	}

	return maybeProcess.cwd();
}

export function isClientRollbarEnabled({
	isNodeRuntime,
	isTestMode,
	isE2EMode,
	isExplicitlyDisabled,
	publicEnabled,
	clientToken,
}: ClientRollbarEnablementOptions): boolean {
	return (
		!isNodeRuntime &&
		!isTestMode &&
		!isE2EMode &&
		!isExplicitlyDisabled &&
		publicEnabled &&
		Boolean(clientToken)
	);
}

const clientRollbarEnabled = isClientRollbarEnabled({
	isNodeRuntime,
	isTestMode,
	isE2EMode,
	isExplicitlyDisabled: isClientExplicitlyDisabled,
	publicEnabled: isExplicitlyEnabled("NEXT_PUBLIC_ROLLBAR_ENABLED"),
	clientToken: clientRollbarToken,
});

export function resolveServerRoot({
	isNodeRuntime,
	configuredRoot,
	getCwd = readProcessCwdSafe,
}: ServerRootOptions): string | undefined {
	if (!isNodeRuntime) {
		return undefined;
	}

	if (configuredRoot) {
		return configuredRoot;
	}

	try {
		const cwd = getCwd().trim();
		return cwd || undefined;
	} catch {
		return undefined;
	}
}
function readNumberEnv(name: string, fallback: number): number {
	const v = process.env[name];
	if (!v) return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Determine Rollbar environment from NODE_ENV.
 */
function getRollbarEnvironment(): string {
	return process.env.NODE_ENV || "development";
}

// ── Base configuration ────────────────────────────────────────────────────

const baseConfig = {
	// In development, disable automatic capture to reduce noise; errors are still
	// reported explicitly via reportError() / logSyncError() etc.
	captureUncaught: !isDevelopment,
	captureUnhandledRejections: !isDevelopment,
	environment: getRollbarEnvironment(),
};

const serverRollbarEnabled = !isE2EMode && !isServerExplicitlyDisabled;

// Client-side configuration (for future React components)
export const clientConfig = {
	accessToken: clientRollbarToken,
	...baseConfig,
	enabled: clientRollbarEnabled,
	captureUncaught: true,
	captureUnhandledRejections: true,
	scrubFields: CLIENT_SCRUB_FIELDS,
	transform: transformClientPayload,
};

// Server-side singleton instance
// In test mode, export a no-op instance to avoid network calls.
export const serverInstance: Rollbar | RollbarTestInstance =
	!isNodeRuntime || isTestMode
		? noopInstance
		: new Rollbar({
				accessToken: isE2EMode ? "dummy-token-for-e2e" : process.env.ROLLBAR_SERVER_TOKEN,
				...baseConfig,
				enabled: serverRollbarEnabled,
				payload: {
					server: { root: resolveServerRoot({ isNodeRuntime, configuredRoot: rollbarServerRoot }) },
				},
				// PII filtering: always scrub secrets; scrub user-identifying fields when consent is not granted
				scrubFields: [
					// Always scrub secrets
					...COMMON_SCRUB_FIELDS,
					// Scrub PII fields unless consent is explicitly granted
					...(isTelemetryConsentGranted()
						? []
						: ["email", "user_email", "userEmail", "user_ip", "ip_address", "person"]),
				],
			});

export const clientInstance: Rollbar | RollbarTestInstance = !clientRollbarEnabled
	? noopInstance
	: new Rollbar({
			...clientConfig,
		});

// Legacy-compatible exports
export const rollbarConfig = {
	accessToken: process.env.ROLLBAR_SERVER_TOKEN,
	...baseConfig,
	enabled: serverRollbarEnabled,
};

export const rollbar = serverInstance;

export const clientRollbarConfig = {
	...clientConfig,
};

// ── Severity & Error Context ──────────────────────────────────────────────

export const ErrorSeverity = {
	CRITICAL: "critical",
	ERROR: "error",
	WARNING: "warning",
	INFO: "info",
	DEBUG: "debug",
} as const;

export type ErrorSeverityType = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

export interface ErrorContext {
	userId?: string;
	userEmail?: string;
	requestId?: string;
	route?: string;
	method?: string;
	userAgent?: string;
	ip?: string;
	timestamp?: Date;
	additionalData?: Record<string, unknown>;
}

export function createErrorContext(
	request?: Request,
	userId?: string,
	requestId?: string,
): ErrorContext {
	return {
		userId,
		requestId,
		route: request ? new URL(request.url).pathname : undefined,
		method: request?.method,
		userAgent: request?.headers.get("user-agent") || undefined,
		ip: request?.headers.get("x-forwarded-for") || request?.headers.get("x-real-ip") || undefined,
		timestamp: new Date(),
	};
}

// ── Structured error reporting with sampling ──────────────────────────────

export function reportError(
	error: Error | string,
	context?: ErrorContext,
	severity: ErrorSeverityType = ErrorSeverity.ERROR,
): void {
	if (!serverRollbarEnabled) return;

	try {
		const rateAll = readNumberEnv("ROLLBAR_SAMPLE_RATE_ALL", 1);
		const rateInfo = readNumberEnv("ROLLBAR_SAMPLE_RATE_INFO", 0.05);
		const rateWarn = readNumberEnv("ROLLBAR_SAMPLE_RATE_WARN", 0.05);
		const rateError = readNumberEnv("ROLLBAR_SAMPLE_RATE_ERROR", 1);
		const rateCritical = readNumberEnv("ROLLBAR_SAMPLE_RATE_CRITICAL", 1);

		const pick = (rate: number) =>
			Math.random() < Math.max(0, Math.min(1, rate)) && Math.random() < rateAll;

		const includePII = isTelemetryConsentGranted();
		const rollbarContext: Record<string, unknown> = {
			person:
				includePII && context?.userId
					? { id: context.userId, email: context.userEmail }
					: undefined,
			request: {
				id: context?.requestId,
				url: context?.route,
				method: context?.method,
				// Only include IP and User-Agent when PII consent is granted
				user_ip: includePII ? context?.ip : undefined,
				headers: includePII ? { "User-Agent": context?.userAgent } : undefined,
			},
			custom: {
				timestamp: context?.timestamp?.toISOString(),
				...context?.additionalData,
			},
		};

		switch (severity) {
			case ErrorSeverity.CRITICAL:
				if (pick(rateCritical)) serverInstance.critical(error, rollbarContext);
				break;
			case ErrorSeverity.ERROR:
				if (pick(rateError)) serverInstance.error(error, rollbarContext);
				break;
			case ErrorSeverity.WARNING:
				if (pick(rateWarn)) serverInstance.warning(error, rollbarContext);
				break;
			case ErrorSeverity.INFO:
				if (pick(rateInfo)) serverInstance.info(error, rollbarContext);
				break;
			case ErrorSeverity.DEBUG:
				if (pick(rateInfo)) serverInstance.debug?.(error, rollbarContext);
				break;
			default:
				if (pick(rateError)) serverInstance.error(error, rollbarContext);
		}
	} catch {
		// Suppress any reporting failures
	}
}

// ── User action tracking ──────────────────────────────────────────────────

export function recordUserAction(
	action: string,
	userId?: string,
	metadata?: Record<string, unknown>,
): void {
	if (!serverRollbarEnabled) return;
	try {
		const includePII = isTelemetryConsentGranted();
		serverInstance.info(`User Action: ${action}`, {
			person: includePII && userId ? { id: userId } : undefined,
			custom: {
				action,
				userAction: true,
				timestamp: new Date().toISOString(),
				...metadata,
			},
		});
	} catch {
		// no-op
	}
}

// ── Flush helper ──────────────────────────────────────────────────────────

export function flushRollbar(): Promise<void> {
	return new Promise((resolve) => {
		if (!serverRollbarEnabled) return resolve();
		try {
			serverInstance.wait(() => resolve());
		} catch {
			resolve();
		}
	});
}
