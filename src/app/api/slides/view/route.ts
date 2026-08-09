// ---------------------------------------------------------------------------
// GET /api/slides/view?courseId=...&file=... — Serve a generated slide HTML file
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_OUTPUT = "output/slides";

export async function GET(req: Request) {
	const url = new URL(req.url);
	const courseId = url.searchParams.get("courseId");
	const file = url.searchParams.get("file");

	if (!courseId || !/^[A-Za-z0-9_.-]+$/.test(courseId)) {
		return NextResponse.json({ error: "Invalid courseId" }, { status: 400 });
	}
	if (!file || !/^[A-Za-z0-9_.-]+\.html$/.test(file)) {
		return NextResponse.json({ error: "Invalid file" }, { status: 400 });
	}

	const outputDir = process.env.SLIDES_OUTPUT_DIR || DEFAULT_OUTPUT;
	const baseDir = path.resolve(process.cwd(), outputDir);
	const filePath = path.resolve(baseDir, courseId, file);

	// Path traversal check
	if (!filePath.startsWith(baseDir + path.sep)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	try {
		// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
		const html = await fs.readFile(filePath, "utf-8");
		return new NextResponse(html, {
			status: 200,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			},
		});
	} catch {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
}
