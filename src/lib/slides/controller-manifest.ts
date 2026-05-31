import fs from "node:fs/promises";
import path from "node:path";
import type {
	ControllerCode,
	ControllerManifest,
	ControllerSlideRef,
} from "@/lib/slides/controller-types";

const DEFAULT_OUTPUT = "output/slides";

const activeIndexByPresentationId = new Map<string, number>();

export class ControllerDomainError extends Error {
	public readonly code: ControllerCode;
	public readonly status: number;
	public readonly details?: Record<string, string | number | boolean>;

	public constructor(
		code: ControllerCode,
		status: number,
		message: string,
		details?: Record<string, string | number | boolean>,
	) {
		super(message);
		this.name = "ControllerDomainError";
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export function isControllerDomainError(error: unknown): error is ControllerDomainError {
	return error instanceof ControllerDomainError;
}

export function resetControllerManifestState(): void {
	activeIndexByPresentationId.clear();
}

export function getActiveIndexForPresentation(presentationId: string): number | undefined {
	return activeIndexByPresentationId.get(presentationId);
}

export function setActiveIndexForPresentation(presentationId: string, index: number): void {
	activeIndexByPresentationId.set(presentationId, index);
}

function normalizeNotesPayload(
	payload: unknown,
): Pick<ControllerSlideRef, "noteTitle" | "noteBody"> {
	if (!payload || typeof payload !== "object") {
		return {};
	}

	const candidate = payload as { noteTitle?: unknown; noteBody?: unknown };
	return {
		noteTitle: typeof candidate.noteTitle === "string" ? candidate.noteTitle : undefined,
		noteBody: typeof candidate.noteBody === "string" ? candidate.noteBody : undefined,
	};
}

function resolveDirs(courseId: string, outputDir?: string): { baseDir: string; courseDir: string } {
	const baseDir = path.resolve(
		process.cwd(),
		outputDir || process.env.SLIDES_OUTPUT_DIR || DEFAULT_OUTPUT,
	);
	const courseDir = path.resolve(baseDir, courseId);
	const rel = path.relative(baseDir, courseDir);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new ControllerDomainError("INVALID_REQUEST", 400, "Invalid courseId path");
	}
	return { baseDir, courseDir };
}

async function readSlides(
	courseDir: string,
): Promise<{ slides: ControllerSlideRef[]; lastUpdated: string }> {
	let entries: string[];
	try {
		entries = await fs.readdir(courseDir);
	} catch (error) {
		const maybeCode = (error as NodeJS.ErrnoException).code;
		if (maybeCode === "ENOENT") {
			throw new ControllerDomainError(
				"PRESENTATION_NOT_FOUND",
				404,
				"No active presentation for the provided courseId",
			);
		}
		throw new ControllerDomainError(
			"SLIDE_STATE_UNAVAILABLE",
			503,
			"Could not read slide directory",
		);
	}

	const htmlFiles = entries
		.filter((entry) => entry.endsWith(".html"))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	if (htmlFiles.length === 0) {
		throw new ControllerDomainError(
			"PRESENTATION_NOT_FOUND",
			404,
			"No active presentation for the provided courseId",
		);
	}

	let latestMtime = 0;
	const slides: ControllerSlideRef[] = [];
	for (const fileName of htmlFiles) {
		try {
			const stat = await fs.stat(path.join(courseDir, fileName));
			if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
		} catch {
			throw new ControllerDomainError("SLIDE_STATE_UNAVAILABLE", 503, "Slide state is unavailable");
		}

		const notesPath = path.join(courseDir, fileName.replace(/\.html$/, ".notes.json"));
		let notes: Pick<ControllerSlideRef, "noteTitle" | "noteBody"> = {};
		try {
			const notesRaw = await fs.readFile(notesPath, "utf8");
			notes = normalizeNotesPayload(JSON.parse(notesRaw));
		} catch (error) {
			const maybeCode = (error as NodeJS.ErrnoException).code;
			if (maybeCode !== "ENOENT") {
				throw new ControllerDomainError(
					"SLIDE_STATE_UNAVAILABLE",
					503,
					"Slide state is unavailable",
				);
			}
		}

		slides.push({
			index: slides.length,
			fileName,
			...notes,
		});
	}

	return {
		slides,
		lastUpdated: new Date(latestMtime || Date.now()).toISOString(),
	};
}

async function resolvePresentationSnapshot(
	courseId: string,
	outputDir?: string,
): Promise<ControllerManifest> {
	const { courseDir } = resolveDirs(courseId, outputDir);
	const { slides, lastUpdated } = await readSlides(courseDir);
	const presentationId = courseId;
	const storedActiveIndex = getActiveIndexForPresentation(presentationId) ?? 0;
	const activeSlideIndex = Math.max(0, Math.min(storedActiveIndex, slides.length - 1));
	setActiveIndexForPresentation(presentationId, activeSlideIndex);

	return {
		courseId,
		presentationId,
		title: `Presentation ${courseId}`,
		aspectRatio: "16:9",
		activeSlideIndex,
		lastUpdated,
		slides,
	};
}

export async function loadControllerManifest(
	courseId: string,
	outputDir?: string,
): Promise<ControllerManifest> {
	return resolvePresentationSnapshot(courseId, outputDir);
}

export async function resolvePresentationSnapshotByPresentationId(
	presentationId: string,
	outputDir?: string,
): Promise<ControllerManifest> {
	return resolvePresentationSnapshot(presentationId, outputDir);
}
