import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
	default: {
		readdir: (...args: unknown[]) => mockReaddir(...args),
		stat: (...args: unknown[]) => mockStat(...args),
		readFile: (...args: unknown[]) => mockReadFile(...args),
	},
	readdir: (...args: unknown[]) => mockReaddir(...args),
	stat: (...args: unknown[]) => mockStat(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
}));

describe("controller-manifest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReaddir.mockResolvedValue(["010_summary.html", "002_intro.html", "001_cover.html"]);
		mockStat.mockResolvedValue({ mtimeMs: Date.UTC(2026, 4, 31) });
		mockReadFile.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }));
	});

	it("returns deterministic slide ordering by filename and stable indexes", async () => {
		const { loadControllerManifest } = await import("@/lib/slides/controller-manifest");

		const manifest = await loadControllerManifest("course-1", "output/slides");

		expect(manifest.presentationId).toBe("course-1");
		expect(manifest.slides.map((slide) => slide.fileName)).toEqual([
			"001_cover.html",
			"002_intro.html",
			"010_summary.html",
		]);
		expect(manifest.slides.map((slide) => slide.index)).toEqual([0, 1, 2]);
	});

	it("throws PRESENTATION_NOT_FOUND for missing course directory", async () => {
		mockReaddir.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "ENOENT" }));
		const { loadControllerManifest, isControllerDomainError } = await import(
			"@/lib/slides/controller-manifest"
		);

		await expect(loadControllerManifest("missing-course", "output/slides")).rejects.toMatchObject({
			code: "PRESENTATION_NOT_FOUND",
			status: 404,
		});

		try {
			await loadControllerManifest("missing-course", "output/slides");
		} catch (error) {
			expect(isControllerDomainError(error)).toBe(true);
		}
	});

	it("throws SLIDE_STATE_UNAVAILABLE when file metadata cannot be read", async () => {
		mockStat.mockRejectedValueOnce(new Error("I/O error"));
		const { loadControllerManifest } = await import("@/lib/slides/controller-manifest");

		await expect(loadControllerManifest("course-1", "output/slides")).rejects.toMatchObject({
			code: "SLIDE_STATE_UNAVAILABLE",
			status: 503,
		});
	});

	it("returns payload valid without notes fields", async () => {
		const { loadControllerManifest } = await import("@/lib/slides/controller-manifest");
		const manifest = await loadControllerManifest("course-1", "output/slides");

		expect(manifest.slides[0].noteTitle).toBeUndefined();
		expect(manifest.slides[0].noteBody).toBeUndefined();
	});

	it("hydrates notes from same-name sidecar files when present", async () => {
		mockReadFile.mockImplementation(async (filePath: string) => {
			if (filePath.endsWith("002_intro.notes.json")) {
				return JSON.stringify({ noteTitle: "Coach note", noteBody: "Discuss" });
			}

			throw Object.assign(new Error("not found"), { code: "ENOENT" });
		});
		const { loadControllerManifest } = await import("@/lib/slides/controller-manifest");
		const manifest = await loadControllerManifest("course-1", "output/slides");

		expect(manifest.slides[1].noteTitle).toBe("Coach note");
		expect(manifest.slides[1].noteBody).toBe("Discuss");
	});

	it("throws SLIDE_STATE_UNAVAILABLE for malformed notes sidecars", async () => {
		mockReadFile.mockResolvedValueOnce("{bad json");
		const { loadControllerManifest } = await import("@/lib/slides/controller-manifest");

		await expect(loadControllerManifest("course-1", "output/slides")).rejects.toMatchObject({
			code: "SLIDE_STATE_UNAVAILABLE",
			status: 503,
		});
	});
});
