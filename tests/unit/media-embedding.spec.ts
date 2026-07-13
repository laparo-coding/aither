// ---------------------------------------------------------------------------
// Unit Tests: Media Embedding in Templates
// Task: T029 [US1c] — TDD: img/video helpers, fallback markup
// ---------------------------------------------------------------------------

import { populateTemplate, registerMediaHelpers } from "@/lib/html/populator";
import { beforeAll, describe, expect, it } from "vitest";

describe("Media Embedding Helpers", () => {
	beforeAll(() => {
		registerMediaHelpers();
	});

	describe("{{image}} helper", () => {
		it("renders an <img> tag with the source URL and alt text", () => {
			const template = "{{image sourceUrl altText}}";
			const result = populateTemplate(template, {
				sourceUrl: "https://hemera.academy/img/photo.jpg",
				altText: "Workshop photo",
			});

			expect(result).toContain("<img");
			expect(result).toContain('src="https://hemera.academy/img/photo.jpg"');
			expect(result).toContain('alt="Workshop photo"');
		});

		it("includes media-fallback CSS class (no inline onerror for XSS safety)", () => {
			const template = "{{image sourceUrl altText}}";
			const result = populateTemplate(template, {
				sourceUrl: "https://hemera.academy/img/photo.jpg",
				altText: "Photo",
			});

			expect(result).not.toContain("onerror");
			expect(result).toContain("media-fallback");
		});

		it("escapes HTML in URL and alt text", () => {
			const template = "{{image sourceUrl altText}}";
			const result = populateTemplate(template, {
				sourceUrl: 'https://example.com/img?a=1&b=2"<>',
				altText: '<script>alert("xss")</script>',
			});

			expect(result).not.toContain('"><>');
			expect(result).not.toContain("<script>");
		});
	});

	describe("{{video}} helper", () => {
		it("renders a <video> tag with correct source", () => {
			const template = "{{video sourceUrl}}";
			const result = populateTemplate(template, {
				sourceUrl: "https://stream.mux.com/abc123.m3u8",
			});

			expect(result).toContain("<video");
			expect(result).toContain("controls");
			expect(result).toContain('src="https://stream.mux.com/abc123.m3u8"');
		});

		it("includes fallback text for browsers without video support", () => {
			const template = "{{video sourceUrl}}";
			const result = populateTemplate(template, {
				sourceUrl: "https://stream.mux.com/abc123.m3u8",
			});

			expect(result).toContain("media-fallback");
		});
	});
});
