// ---------------------------------------------------------------------------
// Private Source Staging
// Task: T014a — Deterministic private staging pathname, scoped signed
// provider-read URL issuance, and idempotent source cleanup (FR-019/FR-021).
// Staging objects are never participant-visible.
// ---------------------------------------------------------------------------

import { createReadStream } from "node:fs";
import { loadConfig } from "@/lib/config";
import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";

/** Deterministic private source-staging pathname for a recording. */
export function buildSourceStagingPathname(bookingId: string, recordingId: string): string {
	return `seminar-sources/${bookingId}/${recordingId}.mp4`;
}

/** Uploads a completed local MP4 to its deterministic private staging path. */
export async function uploadRecordingToStaging(
	bookingId: string,
	recordingId: string,
	filePath: string,
): Promise<string> {
	const token = loadConfig().BLOB_READ_WRITE_TOKEN;
	if (!token) {
		throw new Error("BLOB_STORAGE_UNAVAILABLE: BLOB_READ_WRITE_TOKEN is not configured");
	}

	const pathname = buildSourceStagingPathname(bookingId, recordingId);
	await put(pathname, createReadStream(filePath), {
		access: "private",
		addRandomSuffix: false,
		allowOverwrite: true,
		contentType: "video/mp4",
		token,
	});
	return pathname;
}

/** Issues a short-lived private read URL scoped to a single staged recording. */
export async function createStagedReadUrl(pathname: string): Promise<string> {
	return createPrivateBlobReadUrl(pathname, Date.now() + 10 * 60 * 1000);
}

/** Issues a private Blob GET URL that expires at the requested timestamp. */
export async function createPrivateBlobReadUrl(
	pathname: string,
	validUntil: number,
): Promise<string> {
	const token = loadConfig().BLOB_READ_WRITE_TOKEN;
	if (!token) {
		throw new Error("BLOB_STORAGE_UNAVAILABLE: BLOB_READ_WRITE_TOKEN is not configured");
	}

	const signedToken = await issueSignedToken({
		token,
		pathname,
		operations: ["get"],
		validUntil,
	});
	const { presignedUrl } = await presignUrl(signedToken, {
		access: "private",
		operation: "get",
		pathname,
		validUntil,
	});
	return presignedUrl;
}

/** Stores the role-separated transcript in the private final-transcript namespace. */
export async function uploadTranscriptToPrivateBlob(
	pathname: string,
	transcript: string,
): Promise<void> {
	const token = loadConfig().BLOB_READ_WRITE_TOKEN;
	if (!token) {
		throw new Error("BLOB_STORAGE_UNAVAILABLE: BLOB_READ_WRITE_TOKEN is not configured");
	}

	await put(pathname, transcript, {
		access: "private",
		addRandomSuffix: false,
		allowOverwrite: true,
		contentType: "text/plain; charset=utf-8",
		token,
	});
}

/** Deletes one private object; Vercel Blob treats an absent pathname as idempotent. */
export async function deletePrivateBlob(pathname: string): Promise<void> {
	const token = loadConfig().BLOB_READ_WRITE_TOKEN;
	if (!token) {
		throw new Error("BLOB_STORAGE_UNAVAILABLE: BLOB_READ_WRITE_TOKEN is not configured");
	}
	await del(pathname, { token });
}

/** Deterministic private final-transcript pathname (distinct from staging). */
export function buildTranscriptPathname(bookingId: string, recordingId: string): string {
	return `seminar-transcripts/${bookingId}/${recordingId}.txt`;
}
