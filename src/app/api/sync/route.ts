// ---------------------------------------------------------------------------
// Sync API Route Handler
// Task: T027 [US1] — POST: trigger sync (202), GET: status, 409 if running
// Task: T012 [005-data-sync] — DataSyncJob envelope, runDataSync()
// ---------------------------------------------------------------------------

import { getRouteAuth } from "@/lib/auth/route-auth";
import { requireSyncAccess } from "@/lib/auth/sync-service-auth";
import { loadConfig } from "@/lib/config";
import { createHemeraClient } from "@/lib/hemera/factory";
import { rollbar } from "@/lib/monitoring/rollbar-official";
import { SyncOrchestrator } from "@/lib/sync/orchestrator";
import type { DataSyncJob } from "@/lib/sync/types";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// ── In-memory state (transient, Constitution VII) ─────────────────────────

let currentJob: DataSyncJob | null = null;
let isSyncRunning = false;
let syncStartedAt: number | null = null;

/** Default timeout: 30 minutes */
const SYNC_TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS) || 30 * 60 * 1000;

/** Simple Promise-based mutex for critical sections */
class SimpleMutex {
	private locked = false;
	private queue: Array<() => void> = [];

	async acquire(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.locked) {
				this.locked = true;
				resolve();
			} else {
				this.queue.push(() => {
					this.locked = true;
					resolve();
				});
			}
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.locked = false;
		}
	}

	async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}
}

const syncMutex = new SimpleMutex();

/** Generate a unique request ID */
function generateRequestId(): string {
	return `req-${uuidv4().slice(0, 8)}`;
}

/** Build response meta object */
function buildMeta(requestId?: string) {
	return {
		requestId: requestId ?? generateRequestId(),
		timestamp: new Date().toISOString(),
	};
}

/** Check if the mutex should be auto-released due to timeout */
function isSyncTimedOut(): boolean {
	if (!isSyncRunning || syncStartedAt === null) return false;
	return Date.now() - syncStartedAt > SYNC_TIMEOUT_MS;
}

/** Force-release a timed-out lock */
function releaseTimedOutLock(): void {
	if (currentJob && currentJob.status === "running") {
		currentJob.status = "failed";
		currentJob.endTime = new Date().toISOString();
		currentJob.durationMs = syncStartedAt ? Date.now() - syncStartedAt : null;
		currentJob.errors.push({
			entity: "sync",
			message: `Sync timed out after ${SYNC_TIMEOUT_MS}ms — mutex auto-released`,
			timestamp: new Date().toISOString(),
		});
	}
	isSyncRunning = false;
	syncStartedAt = null;
}

/** Exported for testing */
export function _getState() {
	return { currentJob, isSyncRunning };
}
export function _resetState() {
	currentJob = null;
	isSyncRunning = false;
	syncStartedAt = null;
}

// ── POST /api/sync — Trigger a data sync ─────────────────────────────────

export async function POST(_req: NextRequest) {
	const authData = await getRouteAuth();
	const authResult = requireSyncAccess(_req, authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	const requestId = generateRequestId();

	// Use mutex to prevent race condition on check-and-set
	return syncMutex.runExclusive(async () => {
		// Check for timed-out lock and auto-release
		if (isSyncRunning && isSyncTimedOut()) {
			releaseTimedOutLock();
		}

		// Mutex: reject concurrent sync
		if (isSyncRunning && currentJob) {
			return NextResponse.json(
				{
					success: false,
					error: {
						code: "SYNC_IN_PROGRESS",
						message: "A sync operation is already running",
					},
					meta: buildMeta(requestId),
				},
				{ status: 409 },
			);
		}

		let outputDir: string;
		let client: Awaited<ReturnType<typeof createHemeraClient>>;
		try {
			const cfg = loadConfig();
			outputDir = cfg.HTML_OUTPUT_DIR;
			client = await createHemeraClient({
				requestId,
				route: "/api/sync",
				method: "POST",
			});
		} catch (err) {
			const errorObj = err instanceof Error ? err : new Error(String(err));
			rollbar.error(errorObj, {
				additionalData: { context: "sync_initialization" },
			});

			return NextResponse.json(
				{
					success: false,
					error: {
						code: "SYNC_INITIALIZATION_FAILED",
						message: "Sync initialization failed",
					},
					meta: buildMeta(requestId),
				},
				{ status: 500 },
			);
		}

		// Create sync job placeholder with DataSyncJob shape
		const jobId = `sync-${Date.now()}`;
		const startTime = new Date().toISOString();
		currentJob = {
			jobId,
			status: "running",
			startTime,
			endTime: null,
			durationMs: null,
			courseId: null,
			noUpcomingCourse: false,
			participantsFetched: 0,
			filesGenerated: 0,
			filesSkipped: 0,
			errors: [],
		};
		isSyncRunning = true;
		syncStartedAt = Date.now();
		const orchestrator = new SyncOrchestrator({
			client,
			outputDir,
			manifestPath: `${outputDir}/.sync-manifest.json`,
		});

		// Run in background — do NOT await
		orchestrator
			.runDataSync()
			.then((completedJob) => {
				// Update state under mutex protection
				return syncMutex.runExclusive(() => {
					// Preserve the original jobId from the route
					currentJob = { ...completedJob, jobId };
				});
			})
			.catch((err) => {
				// Log to Rollbar immediately
				const errorObj = err instanceof Error ? err : new Error(String(err));
				rollbar.error(errorObj, {
					additionalData: { context: "sync_background_execution" },
				});

				// Update state under mutex protection
				return syncMutex.runExclusive(() => {
					if (currentJob) {
						currentJob.status = "failed";
						currentJob.endTime = new Date().toISOString();
						currentJob.durationMs = syncStartedAt ? Date.now() - syncStartedAt : null;
						currentJob.errors.push({
							entity: "sync",
							message: err instanceof Error ? err.message : String(err),
							timestamp: new Date().toISOString(),
						});
					}
				});
			})
			.finally(() => {
				return syncMutex.runExclusive(() => {
					isSyncRunning = false;
					syncStartedAt = null;
				});
			});

		// Respond immediately with 202 + envelope
		return NextResponse.json(
			{
				success: true,
				data: {
					jobId,
					status: "running",
					startTime,
				},
				meta: buildMeta(requestId),
			},
			{ status: 202 },
		);
	});
}

// ── GET /api/sync — Get sync status ──────────────────────────────────────

export async function GET(_req: NextRequest) {
	const authData = await getRouteAuth();
	const authResult = requireSyncAccess(_req, authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	const requestId = generateRequestId();

	if (!currentJob) {
		return NextResponse.json(
			{
				success: false,
				error: {
					code: "NO_SYNC_JOB",
					message: "No sync operation has been run",
				},
				meta: buildMeta(requestId),
			},
			{ status: 404 },
		);
	}

	// Check if the running job has timed out — use mutex to protect state access
	return syncMutex.runExclusive(async () => {
		if (currentJob && currentJob.status === "running" && isSyncTimedOut()) {
			releaseTimedOutLock();
			return NextResponse.json(
				{
					success: false,
					error: {
						code: "SYNC_JOB_TIMED_OUT",
						message: `Sync job timed out after ${SYNC_TIMEOUT_MS}ms — mutex auto-released`,
					},
					meta: buildMeta(requestId),
				},
				{ status: 408 },
			);
		}

		return NextResponse.json(
			{
				success: true,
				data: currentJob,
				meta: buildMeta(requestId),
			},
			{ status: 200 },
		);
	});
}
