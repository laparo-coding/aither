// ---------------------------------------------------------------------------
// Slide Generation — Generator Orchestrator
// Task: T007 (file writer), T009 (lesson fetching), T012 (material fetching),
//       T016 (full pipeline orchestrator)
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HemeraClient } from "@/lib/hemera/client";
import {
	LessonsResponseSchema,
	MediaAssetsResponseSchema,
	ServiceMaterialsResponseSchema,
	TextContentsResponseSchema,
} from "@/lib/hemera/schemas";
import { serverInstance } from "@/lib/monitoring/rollbar-official";
import { getNextCourse, getNextCourseWithParticipants } from "./course-resolver";
import { wrapInLayout } from "./html-layout";
import { distributeByIdentifier } from "./identifier-distributor";
import { detectMode, groupMaterialsByMaterialId } from "./mode-detector";
import { parseSections } from "./section-parser";
import {
	buildCurriculumSlide,
	buildImageSlide,
	buildIntroSlide,
	buildTextSlide,
	buildVideoSlide,
} from "./slide-builder";
import { buildSlideContext } from "./slide-context";
import { parsePlaceholders, replaceCollection, replaceScalars } from "./template-engine";
import type { GeneratedSlide, SlideGenerationEvent, SlideGenerationResult } from "./types";

/** German umlaut / special-char transliteration map */
const GERMAN_MAP: Record<string, string> = {
	ä: "ae",
	ö: "oe",
	ü: "ue",
	ß: "ss",
	Ä: "Ae",
	Ö: "Oe",
	Ü: "Ue",
};
const GERMAN_RE = new RegExp(`[${Object.keys(GERMAN_MAP).map(escapeRegexChar).join("")}]`, "g");

/** Escape a single character for safe use inside a RegExp character class. */
function escapeRegexChar(ch: string): string {
	// Characters with special meaning inside a character class
	if (ch === "\\" || ch === "]" || ch === "^") return `\\${ch}`;
	return ch;
}

/** Convert text to a URL/filename-safe slug: lowercase, German transliteration, diacritics stripped, hyphens. */
function slugify(text: string): string {
	return text
		.replace(GERMAN_RE, (ch) => GERMAN_MAP[ch] ?? ch)
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function lessonSlugOrFallback(lessonTitle: string, lessonIndex: number): string {
	const slug = slugify(lessonTitle);
	if (slug) return slug;
	return `lesson-${String(lessonIndex).padStart(2, "0")}`;
}

function stableIdDescriptor(sourceId: string): string {
	const slug = slugify(sourceId);
	return slug || "item";
}

function lessonDescriptor(
	lesson: { title: string; sourceId: string },
	lessonIndex: number,
): string {
	return `${lessonSlugOrFallback(lesson.title, lessonIndex)}-${stableIdDescriptor(lesson.sourceId)}`;
}

function mediaDescriptor(
	media: { sourceId: string; mediaType: "image" | "video"; altText: string | null },
	lessonIdDescriptor: string,
): string {
	const mediaTitleSlug = slugify(media.altText ?? "");
	const mediaIdDescriptor = stableIdDescriptor(media.sourceId);
	if (mediaTitleSlug) return `${mediaTitleSlug}-${mediaIdDescriptor}`;
	return `${lessonIdDescriptor}-${media.mediaType}-${mediaIdDescriptor}`;
}

/** Extract the first name from a full name and slugify it. */
function extractFirstName(fullName: string | undefined): string {
	if (!fullName) return "unbekannt";
	const first = fullName.trim().split(/\s+/)[0];
	return first ? slugify(first) : "unbekannt";
}

export interface SlideGeneratorOptions {
	client: HemeraClient;
	outputDir: string;
}

/**
 * Orchestrates the full slide generation pipeline:
 * 1. Clear output directory
 * 2. Resolve next upcoming course
 * 3. Generate intro slide
 * 4. Fetch and generate curriculum slides
 * 5. Fetch and generate material slides
 * 6. Return result with slide count
 */
export class SlideGenerator {
	private readonly client: HemeraClient;
	private readonly outputDir: string;

	constructor(options: SlideGeneratorOptions) {
		this.client = options.client;
		this.outputDir = options.outputDir;
	}

	/**
	 * Runs the full slide generation pipeline.
	 *
	 * @returns Result with slide count, course info, and slide metadata
	 */
	async generate(): Promise<SlideGenerationResult> {
		const startMs = Date.now();
		const slides: GeneratedSlide[] = [];

		// Global slide sequence counter — determines presentation order via filename.
		let slideSeq = 1;
		const seqFilename = (identifier: string, participantName?: string): string => {
			const seq = String(slideSeq++).padStart(3, "0");
			const slug = slugify(identifier);
			if (participantName) {
				return `${seq}_${slug}_${extractFirstName(participantName)}.html`;
			}
			return `${seq}_${slug}.html`;
		};

		// Step 1: Resolve next course via Service API
		const courseDetail = await getNextCourseWithParticipants(this.client);
		if (!courseDetail) {
			throw new Error("No upcoming course found.");
		}

		const courseId = courseDetail.id;
		const courseTitle = courseDetail.title;

		// Validate courseId before using it in filesystem paths
		if (!courseId || typeof courseId !== "string" || !/^[\w-]+$/.test(courseId)) {
			throw new Error(
				`Invalid courseId: must be alphanumeric/hyphens/underscores only, got "${String(courseId)}"`,
			);
		}

		// Step 2: Clear and prepare course-specific output directory
		const courseOutputDir = path.join(this.outputDir, courseId);
		const resolvedOutput = path.resolve(courseOutputDir);
		const resolvedBase = path.resolve(this.outputDir);
		if (!resolvedOutput.startsWith(resolvedBase + path.sep)) {
			throw new Error(`Path traversal detected: courseId "${courseId}" escapes output directory`);
		}
		await this.clearDir(courseOutputDir);

		// Step 3: Try legacy endpoints (intro, curriculum, content slides)
		// These may not be available on all Hemera instances
		let seminar: Awaited<ReturnType<typeof getNextCourse>> | null = null;
		try {
			seminar = await getNextCourse(this.client);
		} catch {
			serverInstance.info(
				"Legacy /seminars endpoint not available — skipping intro/curriculum slides",
			);
		}

		if (seminar) {
			const introHtml = buildIntroSlide(seminar);
			const introFilename = seqFilename("intro");
			await this.writeSlide(courseOutputDir, introFilename, introHtml);
			slides.push({ filename: introFilename, type: "intro", title: seminar.title });

			try {
				const allLessons = await this.client.get("/lessons", LessonsResponseSchema);
				const courseLessons = allLessons
					.filter((l) => l.seminarId === seminar?.sourceId)
					.sort((a, b) => a.sequence - b.sequence);

				for (const [lessonIdx, lesson] of courseLessons.entries()) {
					const descriptor = lessonDescriptor(lesson, lessonIdx + 1);
					const html = buildCurriculumSlide(lesson);
					const filename = seqFilename(descriptor);
					await this.writeSlide(courseOutputDir, filename, html);
					slides.push({ filename, type: "curriculum", title: lesson.title });
				}

				const allTexts = await this.client.get("/texts", TextContentsResponseSchema);
				const allMedia = await this.client.get("/media", MediaAssetsResponseSchema);

				for (const [lessonIdx, lesson] of courseLessons.entries()) {
					const lessonTexts = allTexts.filter(
						(t) => t.entityRef.type === "lesson" && t.entityRef.id === lesson.sourceId,
					);
					const lessonMedia = allMedia.filter(
						(m) => m.entityRef.type === "lesson" && m.entityRef.id === lesson.sourceId,
					);

					const lessonIdDescriptor = lessonDescriptor(lesson, lessonIdx + 1);

					for (const text of lessonTexts) {
						const html = buildTextSlide(text);
						const filename = seqFilename(
							`${lessonIdDescriptor}-text-${stableIdDescriptor(text.sourceId)}`,
						);
						await this.writeSlide(courseOutputDir, filename, html);
						slides.push({ filename, type: "material", title: "Text Content" });
					}

					for (const media of lessonMedia) {
						const html =
							media.mediaType === "image" ? buildImageSlide(media) : buildVideoSlide(media);
						const descriptor = mediaDescriptor(media, lessonIdDescriptor);
						const filename = seqFilename(descriptor);
						await this.writeSlide(courseOutputDir, filename, html);
						slides.push({ filename, type: "material", title: media.altText ?? media.mediaType });
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				serverInstance.info(`Legacy content endpoints not available: ${msg}`);
			}
		}

		// Step 7: Materials pipeline — fetch via Service API, detect mode, process templates
		const event: SlideGenerationEvent = {
			event: "slides.generated",
			courseId: courseId,
			totalSlides: 0,
			materialSlides: 0,
			skippedSections: 0,
			modeACount: 0,
			modeBCount: 0,
			durationMs: 0,
			errors: [],
		};

		let templateSlideCount = 0;

		try {
			if (courseDetail) {
				event.courseId = courseDetail.id;
				const context = buildSlideContext(courseDetail);
				const materialsResp = await this.client.get(
					`/api/service/courses/${courseDetail.id}/materials`,
					ServiceMaterialsResponseSchema,
				);

				const grouped = groupMaterialsByMaterialId(materialsResp.data.topics);

				for (const [, material] of grouped) {
					if (material.htmlContent === null) {
						event.skippedSections++;
						serverInstance.warning(
							`Skipping material "${material.identifier}" — null htmlContent`,
							{ materialId: material.materialId },
						);
						continue;
					}

					const placeholders = parsePlaceholders(material.htmlContent);
					const hasCollection = placeholders.some((p) => p.type === "collection");
					const mode = detectMode(
						material.htmlContent,
						material.curriculumLinkCount,
						hasCollection,
					);

					if (mode === "identifier-distribution") {
						// Mode B: distribute template across participants
						const collectionName =
							placeholders.find((p) => p.type === "collection")?.key ?? "participant";
						const records = context.collections[collectionName] ?? [];
						const distributed = distributeByIdentifier(
							material.htmlContent,
							material.identifier,
							collectionName,
							records,
							context.scalars,
							material.curriculumLinkCount,
						);
						for (const dist of distributed) {
							const participantName = records[dist.participantIndex]?.name;
							const filename = seqFilename(material.identifier, participantName);
							const wrapped = wrapInLayout(material.title, dist.html);
							await this.writeSlide(courseOutputDir, filename, wrapped);
							slides.push({
								filename,
								type: "material",
								title: material.title,
							});
							templateSlideCount++;
						}
						event.modeBCount++;
					} else if (mode === "section-iteration") {
						// Mode A: iterate sections × participants
						const sections = parseSections(material.htmlContent);
						const hasAnySectionWithCollections = sections.some((s) => s.collections.size > 0);

						for (const section of sections) {
							const collectionName = section.collections.keys().next().value ?? "participant";
							const records = context.collections[collectionName] ?? [];

							if (records.length === 0 && section.collections.size > 0) {
								// No records for this collection — skip to avoid unreplaced placeholders
								event.skippedSections++;
								serverInstance.warning(
									`Skipping section ${section.index} of "${material.identifier}" — 0 records for "${collectionName}"`,
									{ materialId: material.materialId, collectionName },
								);
								continue;
							}

							if (records.length > 0 && section.collections.size > 0) {
								const rendered = replaceCollection(
									section.body,
									collectionName,
									records,
									context.scalars,
								);
								for (let ri = 0; ri < rendered.length; ri++) {
									const participantName = records[ri]?.name;
									const filename = seqFilename(material.identifier, participantName);
									const wrapped = wrapInLayout(material.title, rendered[ri]);
									await this.writeSlide(courseOutputDir, filename, wrapped);
									slides.push({
										filename,
										type: "material",
										title: material.title,
									});
									templateSlideCount++;
								}
							} else if (hasAnySectionWithCollections) {
								// Skip scalar-only sections when the material also has collection sections.
								// These are typically title/closing slides that aren't needed individually.
								event.skippedSections++;
								serverInstance.info(
									`Skipping scalar-only section ${section.index} of "${material.identifier}" — material has collection sections`,
									{ materialId: material.materialId },
								);
							} else {
								// Pure scalar-only material with section tags: apply scalars only
								const rendered = replaceScalars(section.body, context.scalars);
								const filename = seqFilename(material.identifier);
								const wrapped = wrapInLayout(material.title, rendered);
								await this.writeSlide(courseOutputDir, filename, wrapped);
								slides.push({
									filename,
									type: "material",
									title: material.title,
								});
								templateSlideCount++;
							}
						}
						event.modeACount++;
					} else {
						// scalar-only: single output file
						const rendered = replaceScalars(material.htmlContent, context.scalars);
						const filename = seqFilename(material.identifier);
						const wrapped = wrapInLayout(material.title, rendered);
						await this.writeSlide(courseOutputDir, filename, wrapped);
						slides.push({
							filename,
							type: "material",
							title: material.title,
						});
						templateSlideCount++;
					}
				}

				event.materialSlides = templateSlideCount;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			event.errors.push(msg);
			serverInstance.warning("Materials pipeline failed — continuing with legacy slides", {
				error: msg,
			});
		}

		event.totalSlides = slides.length;
		event.durationMs = Date.now() - startMs;
		serverInstance.info("Slide generation complete", event);

		return {
			slidesGenerated: slides.length,
			courseTitle: courseTitle,
			courseId: courseId,
			slides,
		};
	}

	/**
	 * Clears the given directory. Creates it if it does not exist.
	 */
	private async clearDir(dir: string): Promise<void> {
		await fs.rm(dir, { recursive: true, force: true });
		await fs.mkdir(dir, { recursive: true });
	}

	/**
	 * Writes a single slide HTML file to the given directory.
	 * Validates that the resolved path stays inside the target directory.
	 */
	private async writeSlide(dir: string, filename: string, html: string): Promise<void> {
		const resolved = path.resolve(dir, filename);
		if (!resolved.startsWith(path.resolve(dir) + path.sep) && resolved !== path.resolve(dir)) {
			throw new Error(`Path traversal detected: "${filename}" escapes output directory`);
		}
		await fs.writeFile(resolved, html, "utf-8");
	}
}
