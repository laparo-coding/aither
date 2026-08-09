import fs from "node:fs/promises";
import path from "node:path";
import { ConnectionStatus } from "@/app/components/dashboard/connection-status";
import { CourseCard } from "@/app/components/dashboard/section-a-course-card";
import { MaterialCard } from "@/app/components/dashboard/section-a-material-card";
import { ParticipantsList } from "@/app/components/dashboard/section-b-participants-list";
import { SteuerungCards } from "@/app/components/dashboard/section-c-steuerung-cards";
import { CameraSection } from "@/app/components/dashboard/section-d-camera-card";
import type { SlideStatus } from "@/app/components/dashboard/types";
import { createHemeraClient } from "@/lib/hemera/factory";
import {
	type ServiceCourseDetail,
	ServiceCourseDetailResponseSchema,
	ServiceCoursesResponseSchema,
} from "@/lib/hemera/schemas";
import { selectNextCourse } from "@/lib/sync/course-selector";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

/** Create an authenticated HemeraClient for SSR data fetching. */
async function createClient() {
	try {
		return await createHemeraClient({ route: "/", method: "GET" });
	} catch {
		return null;
	}
}

async function fetchSlideStatus(courseId: string | null): Promise<SlideStatus> {
	const notGenerated: SlideStatus = {
		status: "not-generated",
		slideCount: 0,
		lastUpdated: null,
		files: [],
		courseId: null,
	};
	const outputDir = process.env.SLIDES_OUTPUT_DIR || "output/slides";
	if (!courseId || !/^[A-Za-z0-9_.-]+$/.test(courseId)) return notGenerated;

	const baseDir = path.resolve(process.cwd(), outputDir);
	const courseDir = path.resolve(baseDir, courseId);
	if (!courseDir.startsWith(baseDir + path.sep)) return notGenerated;

	try {
		// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
		const entries = await fs.readdir(courseDir);
		const htmlFiles = entries.filter((f) => f.endsWith(".html"));

		if (htmlFiles.length === 0) {
			return { status: "not-generated", slideCount: 0, lastUpdated: null, files: [], courseId };
		}

		let latestMtime = 0;
		for (const file of htmlFiles) {
			// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
			const stat = await fs.stat(path.join(courseDir, file));
			if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
		}

		return {
			status: "generated",
			slideCount: htmlFiles.length,
			lastUpdated: new Date(latestMtime).toISOString(),
			files: htmlFiles.sort(),
			courseId,
		};
	} catch {
		return { status: "not-generated", slideCount: 0, lastUpdated: null, files: [], courseId };
	}
}

/** Detect the most recently modified course directory in output/slides/. */
async function detectSlideCourseId(): Promise<string | null> {
	const outputDir = process.env.SLIDES_OUTPUT_DIR || "output/slides";
	const baseDir = path.resolve(process.cwd(), outputDir);
	try {
		// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
		const entries = await fs.readdir(baseDir, { withFileTypes: true });
		const dirs = entries.filter((e) => e.isDirectory() && /^[A-Za-z0-9_.-]+$/.test(e.name));
		let latest: { name: string; mtime: number } | null = null;
		for (const dir of dirs) {
			// nosemgrep: javascript.lang.security.audit.path-traversal.path-traversal
			const stat = await fs.stat(path.join(baseDir, dir.name));
			if (!latest || stat.mtimeMs > latest.mtime) {
				latest = { name: dir.name, mtime: stat.mtimeMs };
			}
		}
		return latest?.name ?? null;
	} catch {
		return null;
	}
}

/** Fetch next course with participants, or null on failure. */
async function fetchNextCourseDetail(): Promise<ServiceCourseDetail | null> {
	const client = await createClient();
	if (!client) return null;

	const coursesResponse = await client.get("/api/service/courses", ServiceCoursesResponseSchema);
	if (!coursesResponse.data) return null;
	const nextCourse = selectNextCourse(coursesResponse.data);
	if (!nextCourse) return null;

	const detailResponse = await client.get(
		`/api/service/courses/${nextCourse.id}`,
		ServiceCourseDetailResponseSchema,
	);
	return detailResponse.data;
}

export default async function Home() {
	let courseDetail: ServiceCourseDetail | null = null;
	let fetchError = false;

	try {
		courseDetail = await fetchNextCourseDetail();
	} catch {
		fetchError = true;
	}

	const slideCourseId = courseDetail?.id ?? (await detectSlideCourseId());
	const slideStatus = await fetchSlideStatus(slideCourseId);

	return (
		<Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
			<Breadcrumbs separator="›" sx={{ mb: 2 }}>
				<Typography
					color="text.primary"
					variant="body2"
					sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
					</svg>
					Admin Dashboard
				</Typography>
			</Breadcrumbs>

			<Box sx={{ mb: 4 }}>
				<Typography variant="h4" component="h1" gutterBottom>
					Berichte &amp; Analysen
				</Typography>
				<Typography variant="body1" color="text.secondary">
					Statistiken, Auslastung und Systemstatus auf einen Blick.
				</Typography>
			</Box>

			{fetchError && <ConnectionStatus probeUrl="/api/hemera-health" />}

			{!fetchError && !courseDetail && (
				<Alert severity="info" data-testid="no-upcoming-course" sx={{ mt: 3, mb: 3 }}>
					Kein kommender Kurs verfügbar.
				</Alert>
			)}

			{courseDetail && (
				<Box
					sx={{
						display: "grid",
						gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
						gap: 2,
						alignItems: "stretch",
						mb: { xs: 4, md: 6 },
					}}
				>
					<CourseCard course={courseDetail} />
					<MaterialCard slideStatus={slideStatus} />
				</Box>
			)}

			{courseDetail && (
				<Box sx={{ mb: { xs: 4, md: 6 } }}>
					<ParticipantsList
						participants={courseDetail.participants}
						hemeraBaseUrl={process.env.HEMERA_API_BASE_URL}
					/>
				</Box>
			)}

			<Box sx={{ mb: { xs: 4, md: 6 } }}>
				<SteuerungCards />
			</Box>

			<CameraSection />
		</Container>
	);
}
