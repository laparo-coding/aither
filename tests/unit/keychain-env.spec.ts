import { resolveKeychainEnvironment } from "@/lib/keychain-env";
import { describe, expect, it } from "vitest";

describe("resolveKeychainEnvironment", () => {
	it("resolves local service references on macOS", () => {
		const env = {
			HEMERA_API_KEY_KEYCHAIN_SERVICE: "hemera-api-key",
			CLERK_SECRET_KEY_KEYCHAIN_SERVICE: "clerk-secret",
			SMTP_PASS_KEYCHAIN_SERVICE: "smtp-password",
			POSTMAN_API_KEY_KEYCHAIN_SERVICE: "postman-api-key",
			WEBCAM_STREAM_URL_KEYCHAIN_SERVICE: "webcam-stream-url",
			AITHER_SYNC_TOKEN_KEYCHAIN_SERVICE: "aither-sync-token",
			URANOS_SYNC_TOKEN_KEYCHAIN_SERVICE: "uranos-sync-token",
			ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE: "assemblyai-api-key",
			ROLLBAR_SERVER_TOKEN_KEYCHAIN_SERVICE: "rollbar-server",
			ROLLBAR_ACCESS_TOKEN_KEYCHAIN_SERVICE: "rollbar-write",
			ROLLBAR_ACCESS_TOKEN_READONLY_KEYCHAIN_SERVICE: "rollbar-read",
		};
		const services: string[] = [];

		resolveKeychainEnvironment({
			env,
			platform: "darwin",
			readSecret: (service) => {
				services.push(service);
				return `${service}-secret`;
			},
		});

		expect(env).toMatchObject({
			HEMERA_API_KEY: "hemera-api-key-secret",
			CLERK_SECRET_KEY: "clerk-secret-secret",
			SMTP_PASS: "smtp-password-secret",
			POSTMAN_API_KEY: "postman-api-key-secret",
			WEBCAM_STREAM_URL: "webcam-stream-url-secret",
			AITHER_SYNC_TOKEN: "aither-sync-token-secret",
			URANOS_SYNC_TOKEN: "uranos-sync-token-secret",
			ASSEMBLY_AI_API_KEY: "assemblyai-api-key-secret",
			ROLLBAR_SERVER_TOKEN: "rollbar-server-secret",
			ROLLBAR_ACCESS_TOKEN: "rollbar-write-secret",
			ROLLBAR_ACCESS_TOKEN_READONLY: "rollbar-read-secret",
		});
		expect(services).toEqual([
			"hemera-api-key",
			"clerk-secret",
			"smtp-password",
			"postman-api-key",
			"webcam-stream-url",
			"aither-sync-token",
			"uranos-sync-token",
			"assemblyai-api-key",
			"rollbar-server",
			"rollbar-write",
			"rollbar-read",
		]);
	});

	it("keeps a directly configured production secret", () => {
		const env = {
			ROLLBAR_SERVER_TOKEN: "production-token",
			ROLLBAR_SERVER_TOKEN_KEYCHAIN_SERVICE: "rollbar-server",
		};

		resolveKeychainEnvironment({
			env,
			platform: "linux",
			readSecret: () => {
				throw new Error("must not be called");
			},
		});

		expect(env.ROLLBAR_SERVER_TOKEN).toBe("production-token");
	});

	it("rejects Keychain references outside macOS", () => {
		expect(() =>
			resolveKeychainEnvironment({
				env: { ROLLBAR_SERVER_TOKEN_KEYCHAIN_SERVICE: "rollbar-server" },
				platform: "linux",
			}),
		).toThrow(/ROLLBAR_SERVER_TOKEN_KEYCHAIN_SERVICE is supported only on macOS/);
	});
});
