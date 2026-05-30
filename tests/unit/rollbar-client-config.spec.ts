import {
	isClientRollbarEnabled,
	resolveServerRoot,
	transformClientPayload,
} from "@/lib/monitoring/rollbar-official";
import { describe, expect, it } from "vitest";

describe("Rollbar client configuration", () => {
	it("requires explicit public enablement and a client token", () => {
		expect(
			isClientRollbarEnabled({
				isNodeRuntime: false,
				isTestMode: false,
				isE2EMode: false,
				isExplicitlyDisabled: false,
				publicEnabled: false,
				clientToken: "token",
			}),
		).toBe(false);

		expect(
			isClientRollbarEnabled({
				isNodeRuntime: false,
				isTestMode: false,
				isE2EMode: false,
				isExplicitlyDisabled: false,
				publicEnabled: true,
				clientToken: "",
			}),
		).toBe(false);

		expect(
			isClientRollbarEnabled({
				isNodeRuntime: false,
				isTestMode: false,
				isE2EMode: false,
				isExplicitlyDisabled: false,
				publicEnabled: true,
				clientToken: "token",
			}),
		).toBe(true);
	});

	it("disables the client instance in server, test, e2e, or explicit-off modes", () => {
		expect(
			isClientRollbarEnabled({
				isNodeRuntime: true,
				isTestMode: false,
				isE2EMode: false,
				isExplicitlyDisabled: false,
				publicEnabled: true,
				clientToken: "token",
			}),
		).toBe(false);

		expect(
			isClientRollbarEnabled({
				isNodeRuntime: false,
				isTestMode: true,
				isE2EMode: false,
				isExplicitlyDisabled: false,
				publicEnabled: true,
				clientToken: "token",
			}),
		).toBe(false);

		expect(
			isClientRollbarEnabled({
				isNodeRuntime: false,
				isTestMode: false,
				isE2EMode: true,
				isExplicitlyDisabled: false,
				publicEnabled: true,
				clientToken: "token",
			}),
		).toBe(false);

		expect(
			isClientRollbarEnabled({
				isNodeRuntime: false,
				isTestMode: false,
				isE2EMode: false,
				isExplicitlyDisabled: true,
				publicEnabled: true,
				clientToken: "token",
			}),
		).toBe(false);
	});

	it("redacts nested client payload fields and removes direct identity or network data", () => {
		const payload: Record<string, unknown> = {
			data: {
				body: {
					person: {
						id: "user_123",
						email: "user@example.com",
					},
					request: {
						url: "/dashboard",
						user_ip: "127.0.0.1",
						headers: {
							Authorization: "Bearer top-secret",
							Cookie: "session=abc",
						},
					},
					custom: {
						email: "nested@example.com",
						sessionId: "sess_123",
						nested: {
							refreshToken: "refresh_123",
							message: "keep me",
						},
					},
				},
			},
		};

		transformClientPayload(payload);

		const body = (payload.data as Record<string, unknown>).body as Record<string, unknown>;
		expect(body.person).toBeUndefined();

		const request = body.request as Record<string, unknown>;
		expect(request.user_ip).toBeUndefined();
		expect(request.headers).toBeUndefined();

		const custom = body.custom as Record<string, unknown>;
		expect(custom.email).toBe("[redacted]");
		expect(custom.sessionId).toBe("[redacted]");

		const nested = custom.nested as Record<string, unknown>;
		expect(nested.refreshToken).toBe("[redacted]");
		expect(nested.message).toBe("keep me");
	});

	it("uses configured server root when provided and otherwise falls back to cwd in node runtime", () => {
		expect(
			resolveServerRoot({
				isNodeRuntime: true,
				configuredRoot: "/opt/app",
				getCwd: () => "/workspace/app",
			}),
		).toBe("/opt/app");

		expect(
			resolveServerRoot({
				isNodeRuntime: true,
				getCwd: () => "/workspace/app",
			}),
		).toBe("/workspace/app");

		expect(
			resolveServerRoot({
				isNodeRuntime: false,
				getCwd: () => {
					throw new Error("should not be called");
				},
			}),
		).toBeUndefined();

		expect(
			resolveServerRoot({
				isNodeRuntime: true,
				getCwd: () => "   ",
			}),
		).toBeUndefined();
	});
});
