// ---------------------------------------------------------------------------
// MUX Uploader Module
// Task: T036 [US6] — Create MUX client with token ID/secret from config,
//                     create direct upload URL, stream MP4 file to MUX,
//                     poll for asset ready status, retrieve playback URL
// ---------------------------------------------------------------------------

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { loadConfig } from "@/lib/config";
import { reportError } from "@/lib/monitoring/rollbar-official";
import Mux from "@mux/mux-node";

// Feature 012: stable playback reference & full-video JWT TTL helpers
export {
	buildStablePlaybackReference,
	computeMuxTokenTtlSeconds,
} from "./mux-uploader-signed";

/** Create a MUX client using credentials from config */
function createMuxClient(): Mux {
	const config = loadConfig();
	if (!config.MUX_TOKEN_ID || !config.MUX_TOKEN_SECRET) {
		throw new Error("MUX_NOT_CONFIGURED: MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set");
	}
	return new Mux({
		tokenId: config.MUX_TOKEN_ID,
		tokenSecret: config.MUX_TOKEN_SECRET,
	});
}

/** Upload result after the full MUX workflow completes */
export interface MuxUploadResult {
	muxAssetId: string;
	muxPlaybackUrl: string;
}

export interface MuxUploadOptions {
	staticRendition?: "highest";
}

/**
 * Upload a local MP4 file to MUX.
 *
 * Steps:
 * 1. Create a direct upload URL via MUX API
 * 2. Stream the file to the upload URL via HTTP PUT
 * 3. Poll for the asset to become "ready"
 * 4. Retrieve the public playback URL
 *
 * @param filePath - Path to the MP4 file
 * @returns The MUX asset ID and public playback URL
 * @throws Error with "MUX_NOT_CONFIGURED:" if credentials missing
 * @throws Error with "MUX_UPLOAD_FAILED:" on any MUX API failure
 */
export async function uploadToMux(
	filePath: string,
	options: MuxUploadOptions = {},
): Promise<MuxUploadResult> {
	// Verify file exists
	try {
		await stat(filePath);
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") {
			throw new Error(`MUX_UPLOAD_FAILED: file not found: ${filePath}`);
		}
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`MUX_UPLOAD_FAILED: cannot access file: ${message}`);
	}

	const mux = createMuxClient();

	// Step 1: Create a direct upload
	let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;
	try {
		upload = await mux.video.uploads.create({
			new_asset_settings: {
				playback_policy: ["public"],
				encoding_tier: "baseline",
				...(options.staticRendition && {
					static_renditions: [{ resolution: options.staticRendition }],
				}),
			},
			cors_origin: "*",
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		throw new Error(`MUX_UPLOAD_FAILED: Failed to create direct upload — ${message}`);
	}

	if (!upload.url) {
		throw new Error("MUX_UPLOAD_FAILED: No upload URL returned");
	}

	// Step 2: Stream the file to MUX via HTTP PUT
	try {
		const fileStream = createReadStream(filePath);
		const fileStats = await stat(filePath);

		const response = await fetch(upload.url, {
			method: "PUT",
			headers: {
				"Content-Type": "video/mp4",
				"Content-Length": String(fileStats.size),
			},
			body: fileStream as unknown as BodyInit,
			// @ts-expect-error Node.js fetch supports duplex
			duplex: "half",
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		throw new Error(`MUX_UPLOAD_FAILED: Failed to upload file — ${message}`);
	}

	// Step 3: Poll for asset readiness (max 5 minutes)
	const assetId = await pollForAsset(mux, upload.id, 300_000, options.staticRendition);

	// Step 4: Get playback URL
	let asset: Awaited<ReturnType<typeof mux.video.assets.retrieve>>;
	try {
		asset = await mux.video.assets.retrieve(assetId);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		reportError(err instanceof Error ? err : new Error(message), undefined, "error");
		throw new Error(`MUX_UPLOAD_FAILED: Failed to retrieve asset — ${message}`);
	}
	const playbackId = asset.playback_ids?.[0]?.id;

	if (!playbackId) {
		throw new Error("MUX_UPLOAD_FAILED: No playback ID found on asset");
	}

	const muxPlaybackUrl = options.staticRendition
		? `https://stream.mux.com/${playbackId}/${options.staticRendition}.mp4`
		: `https://stream.mux.com/${playbackId}.m3u8`;

	return {
		muxAssetId: assetId,
		muxPlaybackUrl,
	};
}

/**
 * Poll MUX upload status until asset is ready.
 */
async function pollForAsset(
	mux: Mux,
	uploadId: string,
	timeoutMs: number,
	staticRendition?: MuxUploadOptions["staticRendition"],
): Promise<string> {
	const start = Date.now();
	let staticRenditionStart: number | null = null;
	const pollInterval = 3_000;
	const maxConsecutiveFailures = 5;
	let consecutiveFailures = 0;

	while (Date.now() - (staticRenditionStart ?? start) < timeoutMs) {
		let uploadStatus: Awaited<ReturnType<typeof mux.video.uploads.retrieve>>;
		try {
			uploadStatus = await mux.video.uploads.retrieve(uploadId);
			consecutiveFailures = 0;
		} catch (err) {
			consecutiveFailures++;
			if (consecutiveFailures >= maxConsecutiveFailures) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(
					`MUX_UPLOAD_FAILED: Failed to retrieve upload status after ${maxConsecutiveFailures} consecutive failures — ${message}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
			continue;
		}

		if (uploadStatus.asset_id && uploadStatus.status === "asset_created") {
			// Check if asset is ready
			let asset: Awaited<ReturnType<typeof mux.video.assets.retrieve>>;
			try {
				asset = await mux.video.assets.retrieve(uploadStatus.asset_id);
			} catch (err) {
				consecutiveFailures++;
				if (consecutiveFailures >= maxConsecutiveFailures) {
					const message = err instanceof Error ? err.message : String(err);
					throw new Error(
						`MUX_UPLOAD_FAILED: Failed to retrieve asset status after ${maxConsecutiveFailures} consecutive failures — ${message}`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, pollInterval));
				continue;
			}
			consecutiveFailures = 0;

			if (asset.status === "ready") {
				if (!staticRendition) {
					return uploadStatus.asset_id;
				}
				staticRenditionStart ??= Date.now();

				const rendition = asset.static_renditions?.files?.find(
					(file) => file.name === `${staticRendition}.mp4`,
				);
				if (rendition?.status === "ready") {
					return uploadStatus.asset_id;
				}
				if (rendition?.status === "errored" || rendition?.status === "skipped") {
					throw new Error(
						`MUX_UPLOAD_FAILED: Static rendition ${staticRendition}.mp4 ${rendition.status}`,
					);
				}
			}
		}

		if (uploadStatus.status === "errored") {
			throw new Error("MUX_UPLOAD_FAILED: Upload errored during processing");
		}

		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error(
		staticRenditionStart
			? "MUX_UPLOAD_FAILED: Static rendition did not become ready within timeout"
			: "MUX_UPLOAD_FAILED: Asset did not become ready within timeout",
	);
}
