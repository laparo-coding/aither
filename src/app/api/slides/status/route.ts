// ---------------------------------------------------------------------------
// GET /api/slides/status?courseId=... — returns slide generation status for a course
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { NextResponse } from "next/server";

interface SlideStatus {
	status: "generated" | "not-generated";
	slideCount: number;
	lastUpdated: string | null;
}

const DEFAULT_OUTPUT = "output/slides";

export async function GET(req: Request) {
	// Authenticate the caller
	const auth = await getRouteAuth();
	if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const url = new URL(req.url);
	const courseId = url.searchParams.get("courseId");

	const notGenerated: SlideStatus = { status: "not-generated", slideCount: 0, lastUpdated: null };

	if (!courseId || !/^[A-Za-z0-9_.-]+$/.test(courseId)) return NextResponse.json(notGenerated);
	if (courseId.length > 128) return NextResponse.json(notGenerated);

	const outputDir = process.env.SLIDES_OUTPUT_DIR || DEFAULT_OUTPUT;
	const baseDir = path.resolve(process.cwd(), outputDir);
	const courseDir = path.resolve(baseDir, courseId);

	// Verify containment using path.relative
	const rel = path.relative(baseDir, courseDir);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return NextResponse.json(notGenerated);

	try {
		// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
		const entries = await fs.readdir(courseDir);
		const htmlFiles = entries.filter((f) => f.endsWith(".html"));

		if (htmlFiles.length === 0) {
			return NextResponse.json(notGenerated);
		}

		let latestMtime = 0;
		for (const file of htmlFiles) {
			// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
			const stat = await fs.stat(path.join(courseDir, file));
			if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
		}

		const status: SlideStatus = {
			status: "generated",
			slideCount: htmlFiles.length,
			lastUpdated: new Date(latestMtime).toISOString(),
		};

		return NextResponse.json(status);
	} catch (err) {
		console.warn("Slide status lookup failed:", err);
		return NextResponse.json(notGenerated);
	}
}
