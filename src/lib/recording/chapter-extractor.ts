// ---------------------------------------------------------------------------
// Chapter Extractor Module (Spec 010)
// Task: T025 — extractChapters: execute ffprobe -show_chapters -of json on
//               the MUX chaptered asset playback URL, parse JSON, convert
//               timebase to seconds, validate chapter count > 0, return
//               ChapterListResponse or throw RemuxFailedError.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { RemuxFailedError } from "./ffmpeg-remux";
import { ChapterListResponseSchema } from "./schemas";
import type { ChapterListResponse } from "./types";

const execFileAsync = promisify(execFile);

interface FfprobeChapter {
	id: number;
	time_base: string;
	start: number;
	end: number;
	tags?: { title?: string };
}

interface FfprobeOutput {
	chapters?: FfprobeChapter[];
}

function timebaseToSeconds(value: number, timebase: string): number {
	const [numerator, denominator] = timebase.split("/").map(Number);
	if (!denominator || Number.isNaN(numerator) || Number.isNaN(denominator)) {
		// Fallback: assume microseconds (1/1_000_000)
		return value / 1_000_000;
	}
	return (value * numerator) / denominator;
}

/**
 * Extract the chapter list from a MUX chaptered asset via ffprobe.
 *
 * @param assetId - Recording session id (used for error context).
 * @param muxPlaybackUrl - MUX playback URL (MP4 derivative) to probe.
 * @returns ChapterListResponse with chapters in seconds.
 * @throws {RemuxFailedError} when ffprobe fails or no chapters are found.
 */
export async function extractChapters(
	assetId: string,
	muxPlaybackUrl: string,
): Promise<ChapterListResponse> {
	let stdout: string;
	try {
		const result = await execFileAsync("ffprobe", [
			"-v",
			"error",
			"-show_chapters",
			"-of",
			"json",
			muxPlaybackUrl,
		]);
		stdout = result.stdout;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new RemuxFailedError(
			`ffprobe chapter extraction failed for asset ${assetId}: ${message}`,
			null,
			message,
		);
	}

	let parsed: FfprobeOutput;
	try {
		parsed = JSON.parse(stdout) as FfprobeOutput;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new RemuxFailedError(
			`ffprobe returned invalid JSON for asset ${assetId}: ${message}`,
			null,
			stdout,
		);
	}

	const chapters = parsed.chapters ?? [];
	if (chapters.length === 0) {
		throw new RemuxFailedError(`No chapters found in MUX asset for ${assetId}`, null, "");
	}

	const chapterSummaries = chapters.map((chapter) => ({
		id: chapter.id,
		start: timebaseToSeconds(chapter.start, chapter.time_base),
		end: timebaseToSeconds(chapter.end, chapter.time_base),
		title: chapter.tags?.title ?? `Chapter ${chapter.id + 1}`,
	}));

	const response = {
		assetId,
		chapters: chapterSummaries,
	};

	const validated = ChapterListResponseSchema.safeParse(response);
	if (!validated.success) {
		throw new RemuxFailedError(
			`Chapter list schema validation failed for asset ${assetId}: ${validated.error.message}`,
			null,
			JSON.stringify(validated.error.issues),
		);
	}

	return validated.data;
}
