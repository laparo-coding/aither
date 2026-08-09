// ---------------------------------------------------------------------------
// Template Population Engine (Handlebars.js)
// Task: T023 [US1] — populateTemplate(templateHtml, data): string
// ---------------------------------------------------------------------------

import Handlebars from "handlebars";

function isAllowedMediaUrl(input: string): boolean {
	const value = input.trim();
	if (!value) return false;
	if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
		return true;
	}

	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function sanitizeMediaUrl(input: string): string {
	return isAllowedMediaUrl(input) ? input.trim() : "#";
}

/**
 * Populates an HTML template with data using Handlebars.
 * - XSS escaping is active by default ({{var}})
 * - Triple-stache ({{{var}}}) for trusted HTML content
 * - Missing placeholders resolve to empty strings
 *
 * @param templateHtml HTML template string
 * @param data         Data object for placeholders
 * @returns            Rendered HTML
 */
export function populateTemplate(templateHtml: string, data: Record<string, unknown>): string {
	const compiled = Handlebars.compile(templateHtml, { noEscape: false });
	return compiled(data);
}

/**
 * Registers Handlebars helpers for media embedding.
 * Must be called once at app startup.
 *
 * Usage in Templates:
 *   {{image sourceUrl altText}}   → <img> with onerror fallback
 *   {{video sourceUrl}}           → <video> with fallback text
 */
export function registerMediaHelpers(): void {
	Handlebars.registerHelper("image", (sourceUrl: string, altText: string) => {
		const safeUrl = Handlebars.Utils.escapeExpression(sanitizeMediaUrl(sourceUrl));
		const safeAlt = Handlebars.Utils.escapeExpression(altText ?? "");
		// Build the <img> element without inline event handlers (onerror) to avoid XSS.
		// The fallback is handled by the consumer via a CSS class.
		// nosemgrep: javascript.handlebars.security.handlebars-safestring-xss
		return new Handlebars.SafeString(
			`<img src="${safeUrl}" alt="${safeAlt}" loading="lazy" class="media-fallback" />`,
		);
	});

	Handlebars.registerHelper("video", (sourceUrl: string) => {
		const safeUrl = Handlebars.Utils.escapeExpression(sanitizeMediaUrl(sourceUrl));
		// nosemgrep: javascript.handlebars.security.handlebars-safestring-xss
		return new Handlebars.SafeString(
			`<video controls preload="metadata" src="${safeUrl}"><p class="media-fallback">Video nicht verfügbar: <a href="${safeUrl}">${safeUrl}</a></p></video>`,
		);
	});
}
