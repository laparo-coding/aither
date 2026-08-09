// ---------------------------------------------------------------------------
// FFmpeg Remux Module (Spec 010)
// Task: T014 — remuxWithChapters: serialize ffmetadata JSON to FFMETADATA1,
//               spawn FFmpeg with -map_metadata 1 -codec copy -movflags +faststart,
//               monitor stderr, return output path or throw RemuxFailedError.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FFMetadataJSON } from "./types";

/** Error thrown when the FFmpeg remux step fails. */
export class RemuxFailedError extends Error {
	public readonly exitCode: number | null;
	public readonly stderr: string;

	constructor(message: string, exitCode: number | null, stderr: string) {
		super(message);
		this.name = "RemuxFailedError";
		this.exitCode = exitCode;
		this.stderr = stderr;
	}
}

/** Options for remuxWithChapters. */
export interface RemuxOptions {
	assetId: string;
	rawMp4Path: string;
	outputPath: string;
	videoDurationMicros: number;
}

const DEFAULT_REMUX_TIMEOUT_MS = 120_000;

function escapeFFMetadataValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/=/g, "\\=")
		.replace(/;/g, "\\;")
		.replace(/#/g, "\\#")
		.replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Serialize an ffmetadata JSON document to the FFMETADATA1 text format.
 *
 * The final chapter's `end` is clamped to `videoDurationMicros` when it is zero
 * (placeholder from Spec 009) or exceeds the actual video duration.
 *
 * @param doc - The ffmetadata JSON document (Spec 009 schema).
 * @param videoDurationMicros - Actual video duration in microseconds (from ffprobe).
 * @returns FFMETADATA1 text ready to be written to a file and passed to FFmpeg.
 */
export function serializeFFMetadata1(doc: FFMetadataJSON, videoDurationMicros: number): string {
	const lines: string[] = [";FFMETADATA1"];

	const chapters = doc.chapters.map((chapter, index) => {
		const isFinal = index === doc.chapters.length - 1;
		const rawEnd = chapter.end;
		const end =
			isFinal && (rawEnd === 0 || rawEnd > videoDurationMicros) ? videoDurationMicros : rawEnd;
		return { ...chapter, end };
	});

	for (const chapter of chapters) {
		lines.push("[CHAPTER]");
		lines.push("TIMEBASE=1/1000000");
		lines.push(`START=${chapter.start}`);
		lines.push(`END=${chapter.end}`);
		lines.push(`title=${escapeFFMetadataValue(chapter.title)}`);
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Remux a raw MP4 with embedded chapter metadata from an ffmetadata JSON document.
 *
 * Steps:
 * 1. Serialize the ffmetadata JSON to FFMETADATA1 text (with final chapter end clamping).
 * 2. Write the FFMETADATA1 text to a temporary file.
 * 3. Spawn FFmpeg with `-map_metadata 1 -codec copy -movflags +faststart`.
 * 4. Monitor stderr; on non-zero exit, throw RemuxFailedError.
 * 5. Clean up the temporary FFMETADATA1 file.
 *
 * @param ffmetadataJson - The ffmetadata JSON document (Spec 009 schema).
 * @param options - Remux options (assetId, raw path, output path, video duration).
 * @returns The output path of the remuxed chaptered MP4.
 * @throws {RemuxFailedError} when FFmpeg exits with a non-zero code.
 */
export async function remuxWithChapters(
	ffmetadataJson: FFMetadataJSON,
	options: RemuxOptions,
): Promise<string> {
	const { assetId, rawMp4Path, outputPath, videoDurationMicros } = options;

	const ffmetadata1Text = serializeFFMetadata1(ffmetadataJson, videoDurationMicros);

	const tempDir = await mkdtemp(join(tmpdir(), `ffmpeg-remux-${assetId}-`));
	const ffmetadata1Path = join(tempDir, "chapters.ffmetadata");

	try {
		await writeFile(ffmetadata1Path, ffmetadata1Text, "utf8");

		const args = [
			"-i",
			rawMp4Path,
			"-i",
			ffmetadata1Path,
			"-map_metadata",
			"1",
			"-codec",
			"copy",
			"-movflags",
			"+faststart",
			"-y",
			outputPath,
		];

		await new Promise<void>((resolve, reject) => {
			const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
			let stderr = "";
			let settled = false;
			const timeout = setTimeout(() => {
				if (settled) return;
				proc.kill("SIGKILL");
				settled = true;
				reject(
					new RemuxFailedError(
						`FFmpeg remux timed out after ${DEFAULT_REMUX_TIMEOUT_MS}ms`,
						null,
						stderr,
					),
				);
			}, DEFAULT_REMUX_TIMEOUT_MS);

			proc.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			proc.on("error", (err: Error) => {
				clearTimeout(timeout);
				if (settled) return;
				settled = true;
				reject(new RemuxFailedError(`FFmpeg spawn failed: ${err.message}`, null, stderr));
			});

			proc.on("close", (code: number | null) => {
				clearTimeout(timeout);
				if (settled) return;
				settled = true;
				if (code === 0) {
					resolve();
				} else {
					reject(new RemuxFailedError(`FFmpeg remux failed with exit code ${code}`, code, stderr));
				}
			});
		});

		return outputPath;
	} catch (error) {
		// Clean up partial output file on failure
		await unlink(outputPath).catch(() => {
			// Ignore cleanup errors (file may not exist)
		});
		if (error instanceof RemuxFailedError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new RemuxFailedError(`Remux orchestration failed: ${message}`, null, "");
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}
