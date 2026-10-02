// ---------------------------------------------------------------------------
// Rollbar Client Configuration — browser-safe subset of rollbar-official.ts
// ---------------------------------------------------------------------------
// This module MUST NOT import any Node.js built-ins (node:crypto, node:fs,
// node:child_process) or server-only modules (keychain-env). Client error
// boundaries (src/app/error.tsx, src/app/global-error.tsx) import from here;
// pulling server modules into the client bundle crashes Turbopack
// ("chunking context does not support external modules").
// Server-side reporting lives in ./rollbar-official.ts.
// ---------------------------------------------------------------------------

import Rollbar from "rollbar";

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

// ── Enablement rules (browser-safe — no process.env server reads beyond
// NEXT_PUBLIC_* which Next.js inlines at build time) ────────────────────────

const isE2EMode = process.env.NEXT_PUBLIC_E2E_TEST === "1";
const isTestMode =
	typeof process.env.NEXT_PUBLIC_NODE_ENV === "undefined" &&
	typeof window === "undefined" &&
	typeof process !== "undefined" &&
	process.env.NODE_ENV === "test";
const isExplicitlyDisabled = process.env.NEXT_PUBLIC_ROLLBAR_ENABLED === "0";
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

export interface ClientRollbarEnablementOptions {
	isTestMode: boolean;
	isE2EMode: boolean;
	isExplicitlyDisabled: boolean;
	publicEnabled: boolean;
	clientToken?: string;
}

export function isClientRollbarEnabled({
	isTestMode,
	isE2EMode,
	isExplicitlyDisabled,
	publicEnabled,
	clientToken,
}: ClientRollbarEnablementOptions): boolean {
	return (
		!isTestMode && !isE2EMode && !isExplicitlyDisabled && publicEnabled && Boolean(clientToken)
	);
}

const clientRollbarEnabled = isClientRollbarEnabled({
	isTestMode,
	isE2EMode,
	isExplicitlyDisabled: isExplicitlyDisabled,
	publicEnabled: process.env.NEXT_PUBLIC_ROLLBAR_ENABLED === "1",
	clientToken: clientRollbarToken,
});

const baseConfig = {
	// In development, disable automatic capture to reduce noise
	captureUncaught: true,
	captureUnhandledRejections: true,
	environment: process.env.NEXT_PUBLIC_NODE_ENV || "development",
};

export const clientConfig = {
	accessToken: clientRollbarToken,
	...baseConfig,
	enabled: clientRollbarEnabled,
	captureUncaught: true,
	captureUnhandledRejections: true,
	scrubFields: CLIENT_SCRUB_FIELDS,
	transform: transformClientPayload,
};

export const clientInstance: Rollbar | RollbarTestInstance = !clientRollbarEnabled
	? noopInstance
	: new Rollbar({
			...clientConfig,
		});

export const clientRollbarConfig = {
	...clientConfig,
};
