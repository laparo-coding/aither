#!/usr/bin/env node
/*
Simple migration helper to re-encrypt Upstash Redis keys.

Usage:
  node scripts/reencrypt-upstash.js --keys key1,key2 --old-key <base64|hex> --new-key <base64|hex> [--dry-run]

Environment fallback:
  UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN are required if not set in env

This script will, for each key:
 - read the value
 - if value starts with 'enc:', decrypt with the provided old key
 - re-encrypt with the provided new key and write back, preserving TTL when possible

Be careful: this script requires access to keys and will overwrite values in your Upstash instance.
*/

let Redis;
try {
	({ Redis } = require("@upstash/redis"));
} catch (_e) {
	console.error("Missing dependency @upstash/redis. Please run: npm install @upstash/redis");
	process.exit(2);
}
const crypto = require("node:crypto");

function parseArgs() {
	const args = process.argv.slice(2);
	const out = {
		keys: [],
		oldKey: process.env.OLD_KEY || null,
		newKey: process.env.NEW_KEY || null,
		dryRun: false,
		idempotent: false,
		swap: false,
		force: false,
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--keys") {
			if (i + 1 >= args.length) {
				console.error("--keys requires a value");
				process.exit(2);
			}
			out.keys = args[++i]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (a === "--old-key") {
			if (i + 1 >= args.length) {
				console.error("--old-key requires a value");
				process.exit(2);
			}
			out.oldKey = args[++i];
		} else if (a === "--new-key") {
			if (i + 1 >= args.length) {
				console.error("--new-key requires a value");
				process.exit(2);
			}
			out.newKey = args[++i];
		} else if (a === "--dry-run") {
			out.dryRun = true;
		} else if (a === "--idempotent") {
			out.idempotent = true;
		} else if (a === "--swap") {
			out.swap = true;
		} else if (a === "--force") {
			out.force = true;
		} else {
			console.error("Unknown arg", a);
			process.exit(2);
		}
	}
	if (out.keys.length === 0) {
		const envKeys = process.env.REENCRYPT_KEYS || process.env.KEYS;
		if (envKeys)
			out.keys = envKeys
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
	}
	return out;
}

function keyBufferFromString(raw) {
	if (!raw) return null;
	// try base64 — validate round-trip to reject arbitrary strings that happen to decode
	try {
		const b = Buffer.from(raw, "base64");
		if (b.length === 32 && b.toString("base64") === raw) return b;
	} catch (_e) {}
	// try hex — validate round-trip
	try {
		const b = Buffer.from(raw, "hex");
		if (b.length === 32 && b.toString("hex").toLowerCase() === raw.toLowerCase()) return b;
	} catch (_e) {}
	throw new Error("Key must be exactly 32 bytes in valid base64 or hex encoding");
}

function encryptWithKey(plaintext, keyBuf) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv, { authTagLength: 16 });
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	const out = Buffer.concat([iv, tag, ciphertext]);
	return `enc:${out.toString("base64")}`;
}

function decryptWithKey(maybeEncrypted, keyBuf) {
	if (!maybeEncrypted.startsWith("enc:")) return maybeEncrypted;
	const b = Buffer.from(maybeEncrypted.slice(4), "base64");
	if (b.length < 28) throw new Error("invalid encrypted payload");
	const iv = b.subarray(0, 12);
	const tag = b.subarray(12, 28);
	const ciphertext = b.subarray(28);
	const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv, { authTagLength: 16 });
	decipher.setAuthTag(tag);
	const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return plain.toString("utf8");
}

async function main() {
	const opts = parseArgs();
	if (!opts.keys.length) {
		console.error("No keys provided. Use --keys key1,key2 or set REENCRYPT_KEYS env var.");
		process.exit(2);
	}

	const url = process.env.UPSTASH_REDIS_REST_URL;
	const token = process.env.UPSTASH_REDIS_REST_TOKEN;
	if (!url || !token) {
		console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in env");
		process.exit(2);
	}

	const redis = new Redis({ url, token });

	const oldKeyBuf = opts.oldKey ? keyBufferFromString(opts.oldKey) : null;
	const newKeyBuf = opts.newKey ? keyBufferFromString(opts.newKey) : null;

	if (!newKeyBuf) {
		console.error("newKey is required (provide via --new-key or NEW_KEY env)");
		process.exit(2);
	}

	console.log("Starting re-encryption for keys:", opts.keys.join(", "));
	if (opts.dryRun) console.log("Dry run mode - no writes will be performed");
	if (opts.idempotent)
		console.log(
			"Idempotent mode - writing re-encrypted values to <key>.reenc (no overwrite of originals). Use --swap to replace originals after verification.",
		);

	const summary = { updated: [], skipped: [], errors: [] };

	const reencWritten = [];
	for (const key of opts.keys) {
		try {
			const raw = await redis.get(key);
			if (raw == null) {
				console.log(`Key ${key}: not found`);
				summary.skipped.push(key);
				continue;
			}

			let value = raw;
			if (typeof value !== "string") {
				// Objects/arrays: serialize to JSON; primitives: coerce to string
				value = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
			}

			let plain;
			if (value.startsWith("enc:")) {
				if (!oldKeyBuf) {
					throw new Error(`Key ${key} is encrypted but no old key provided`);
				}
				plain = decryptWithKey(value, oldKeyBuf);
			} else {
				plain = value;
			}

			const newEnc = encryptWithKey(plain, newKeyBuf);

			const targetKey = opts.idempotent ? `${key}.reenc` : key;

			if (opts.dryRun) {
				console.log(
					`Key ${key}: would write encrypted value to ${targetKey} (len ${newEnc.length})`,
				);
				summary.updated.push(key);
				if (opts.idempotent) reencWritten.push({ key, targetKey });
				continue;
			}

			// try to preserve TTL if supported
			let ttlSeconds = null;
			if (typeof redis.ttl === "function") {
				try {
					const t = await redis.ttl(key);
					if (typeof t === "number" && t > 0) ttlSeconds = t;
				} catch (_e) {
					// ignore
				}
			}

			// when idempotent and target exists, avoid overwriting unless --force
			if (opts.idempotent && !opts.force) {
				try {
					const existing = await redis.get(targetKey);
					if (existing != null) {
						console.log(`Target ${targetKey} already exists; skipping (use --force to overwrite)`);
						summary.skipped.push(key);
						continue;
					}
				} catch (_e) {
					// ignore
				}
			}

			if (ttlSeconds != null) {
				await redis.set(targetKey, newEnc, { ex: ttlSeconds });
			} else {
				await redis.set(targetKey, newEnc);
			}

			console.log(`Key ${key}: re-encrypted -> ${targetKey}`);
			summary.updated.push(key);
			if (opts.idempotent) reencWritten.push({ key, targetKey });
		} catch (err) {
			console.error(`Key ${key}: error:`, err.message || err);
			summary.errors.push({ key, err: String(err) });
		}
	}

	// If requested, perform swap of .reenc keys into originals
	if (opts.swap) {
		console.log("Swap requested: replacing originals from .reenc keys");
		const swapSummary = { swapped: [], skipped: [], errors: [] };
		for (const k of opts.keys) {
			const targetKey = `${k}.reenc`;
			try {
				const exists = await redis.get(targetKey);
				if (exists == null) {
					console.log(`Swap ${k}: ${targetKey} not found; skipping`);
					swapSummary.skipped.push(k);
					continue;
				}

				if (opts.dryRun) {
					console.log(`Swap ${k}: would copy ${targetKey} -> ${k} and delete ${targetKey}`);
					swapSummary.swapped.push(k);
					continue;
				}

				// try to preserve TTL from the reenc key
				let ttlSeconds = null;
				if (typeof redis.ttl === "function") {
					try {
						const t = await redis.ttl(targetKey);
						if (typeof t === "number" && t > 0) ttlSeconds = t;
					} catch (_e) {
						// ignore
					}
				}

				if (ttlSeconds != null) {
					await redis.set(k, exists, { ex: ttlSeconds });
				} else {
					await redis.set(k, exists);
				}
				await redis.del(targetKey).catch(() => {});
				console.log(`Swap ${k}: replaced from ${targetKey}`);
				swapSummary.swapped.push(k);
			} catch (err) {
				console.error(`Swap ${k}: error:`, err.message || err);
				swapSummary.errors.push({ key: k, err: String(err) });
			}
		}
		console.log("Swap summary:", swapSummary);
	}

	console.log("Done. Summary:", summary);
	process.exit(0);
}

if (require.main === module) {
	main().catch((err) => {
		console.error("Fatal:", err);
		process.exit(1);
	});
}
