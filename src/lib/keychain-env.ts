import { execFileSync } from "node:child_process";
import { isPlaceholderValue } from "./env-placeholders";

type Environment = Record<string, string | undefined>;
type SecretReader = (service: string) => string;

const keychainMappings = [
	["HEMERA_API_KEY", "HEMERA_API_KEY_KEYCHAIN_SERVICE"],
	["CLERK_SECRET_KEY", "CLERK_SECRET_KEY_KEYCHAIN_SERVICE"],
	["SMTP_PASS", "SMTP_PASS_KEYCHAIN_SERVICE"],
	["POSTMAN_API_KEY", "POSTMAN_API_KEY_KEYCHAIN_SERVICE"],
	["WEBCAM_STREAM_URL", "WEBCAM_STREAM_URL_KEYCHAIN_SERVICE"],
	["AITHER_SYNC_TOKEN", "AITHER_SYNC_TOKEN_KEYCHAIN_SERVICE"],
	["URANOS_SYNC_TOKEN", "URANOS_SYNC_TOKEN_KEYCHAIN_SERVICE"],
	["ASSEMBLY_AI_API_KEY", "ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE"],
	["ROLLBAR_SERVER_TOKEN", "ROLLBAR_SERVER_TOKEN_KEYCHAIN_SERVICE"],
	["ROLLBAR_ACCESS_TOKEN", "ROLLBAR_ACCESS_TOKEN_KEYCHAIN_SERVICE"],
	["ROLLBAR_ACCESS_TOKEN_READONLY", "ROLLBAR_ACCESS_TOKEN_READONLY_KEYCHAIN_SERVICE"],
] as const;

function readMacOsKeychainSecret(service: string): string {
	return execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
		encoding: "utf8",
	}).trim();
}

export function resolveKeychainEnvironment(options?: {
	env?: Environment;
	platform?: NodeJS.Platform;
	readSecret?: SecretReader;
}): void {
	const env = options?.env ?? process.env;
	const platform = options?.platform ?? process.platform;
	const readSecret = options?.readSecret ?? readMacOsKeychainSecret;

	for (const [environmentVariable, serviceVariable] of keychainMappings) {
		// Placeholder sentinels (e.g. __REQUIRED__) count as "not set" so the
		// Keychain reference still resolves the real secret.
		const directValue = env[environmentVariable];
		if ((directValue && !isPlaceholderValue(directValue)) || !env[serviceVariable]) continue;

		if (platform !== "darwin") {
			throw new Error(
				`${serviceVariable} is supported only on macOS; set ${environmentVariable} directly`,
			);
		}

		const secret = readSecret(env[serviceVariable]);
		if (!secret) {
			throw new Error(`Keychain service ${env[serviceVariable]} returned an empty secret`);
		}

		env[environmentVariable] = secret;
	}
}
