// ---------------------------------------------------------------------------
// Slide Generation — Shared Utilities
// Helper functions for slugs, descriptors, and name extraction.
// ---------------------------------------------------------------------------

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
// Pre-built regex for German umlauts — keys are static and safe (no special regex chars).
const GERMAN_RE = /[äöüßÄÖÜ]/g;

/** Convert text to a URL/filename-safe slug: lowercase, German transliteration, diacritics stripped, hyphens. */
export function slugify(text: string): string {
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

export function stableIdDescriptor(sourceId: string): string {
	const slug = slugify(sourceId);
	return slug || "item";
}

export function lessonDescriptor(
	lesson: { title: string; sourceId: string },
	lessonIndex: number,
): string {
	return `${lessonSlugOrFallback(lesson.title, lessonIndex)}-${stableIdDescriptor(lesson.sourceId)}`;
}

export function mediaDescriptor(
	media: { sourceId: string; mediaType: "image" | "video"; altText: string | null },
	lessonIdDescriptor: string,
): string {
	const mediaTitleSlug = slugify(media.altText ?? "");
	const mediaIdDescriptor = stableIdDescriptor(media.sourceId);
	if (mediaTitleSlug) return `${mediaTitleSlug}-${mediaIdDescriptor}`;
	return `${lessonIdDescriptor}-${media.mediaType}-${mediaIdDescriptor}`;
}

/** Extract the first name from a full name and slugify it. */
export function extractFirstName(fullName: string | undefined): string {
	if (!fullName) return "unbekannt";
	const first = fullName.trim().split(/\s+/)[0];
	return first ? slugify(first) : "unbekannt";
}
