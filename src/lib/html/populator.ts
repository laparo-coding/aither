// ---------------------------------------------------------------------------
// Template Population Engine (Handlebars.js)
// Task: T023 [US1] — populateTemplate(templateHtml, data): string
// ---------------------------------------------------------------------------

import Handlebars from "handlebars";

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
		const safeUrl = Handlebars.Utils.escapeExpression(sourceUrl);
		const safeAlt = Handlebars.Utils.escapeExpression(altText ?? "");
		// Build the <img> element without inline event handlers (onerror) to avoid XSS.
		// The fallback is handled by the consumer via a CSS class.
		return new Handlebars.SafeString(
			`<img src="${safeUrl}" alt="${safeAlt}" loading="lazy" class="media-fallback" />`,
		);
	});

	Handlebars.registerHelper("video", (sourceUrl: string) => {
		const safeUrl = Handlebars.Utils.escapeExpression(sourceUrl);
		return new Handlebars.SafeString(
			`<video controls preload="metadata" src="${safeUrl}"><p class="media-fallback">Video nicht verfügbar: <a href="${safeUrl}">${safeUrl}</a></p></video>`,
		);
	});
}
