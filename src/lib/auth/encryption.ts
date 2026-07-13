import crypto from "node:crypto";

const PREFIX = "enc:";

export function getKey(): Buffer | null {
	const raw = process.env.TOKEN_STORE_ENCRYPTION_KEY;
	if (!raw) return null;
	// Accept base64 or hex; try base64 first
	try {
		const buf = Buffer.from(raw, "base64");
		if (buf.length === 32) return buf;
	} catch {
		// ignore
	}
	try {
		const buf = Buffer.from(raw, "hex");
		if (buf.length === 32) return buf;
	} catch {
		// ignore
	}
	// If not 32 bytes, warn and ignore
	console.warn("TOKEN_STORE_ENCRYPTION_KEY is present but not a 32-byte key; encryption disabled");
	return null;
}

export function encryptString(plaintext: string): string {
	const key = getKey();
	if (!key) return plaintext;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	const out = Buffer.concat([iv, tag, ciphertext]);
	return PREFIX + out.toString("base64");
}

export function decryptString(maybeEncrypted: string): string {
	if (!maybeEncrypted.startsWith(PREFIX)) return maybeEncrypted;
	const key = getKey();
	if (!key) {
		throw new Error("Cannot decrypt: TOKEN_STORE_ENCRYPTION_KEY is not set but value is encrypted");
	}
	const b = Buffer.from(maybeEncrypted.slice(PREFIX.length), "base64");
	if (b.length < 12 + 16) throw new Error("invalid encrypted payload");
	const iv = b.subarray(0, 12);
	const tag = b.subarray(12, 28);
	const ciphertext = b.subarray(28);
	const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
	decipher.setAuthTag(tag);
	const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return plain.toString("utf8");
}

export function isEncryptedString(value: unknown): value is string {
	// Check prefix first (cheap) before calling getKey() to avoid log spam
	return typeof value === "string" && value.startsWith(PREFIX) && getKey() !== null;
}

export default {
	encryptString,
	decryptString,
	isEncryptedString,
};
