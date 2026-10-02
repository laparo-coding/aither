// ---------------------------------------------------------------------------
// Hemera Seminar Recording Service Client
// Task: T012 — Authenticated client for booking lookup, idempotent workflow
// upsert, workflow read, and queued-job listing per the OpenAPI contract.
// Uses X-API-Key service auth; no secrets are logged.
// ---------------------------------------------------------------------------

import type { z } from "zod";
import { getServiceToken } from "../auth/service-token";
import { loadConfig } from "../config";
import { BookingContextSchema, JobListingSchema, SeminarRecordingWorkflowSchema } from "./schemas";
import type { WorkflowStatus, WorkflowUpdate } from "./types";

export interface HemeraSeminarRecordingClientOptions {
	baseUrl: string;
	getToken: () => Promise<string>;
	fetchFn?: typeof fetch;
	maxRetries?: number;
}

export function createHemeraSeminarRecordingClient(): HemeraSeminarRecordingClient {
	const config = loadConfig();
	return new HemeraSeminarRecordingClient({
		baseUrl: config.HEMERA_API_BASE_URL,
		getToken: getServiceToken,
	});
}

export class HemeraApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly statusText: string,
		public readonly body: string,
		public readonly url: string,
	) {
		super(`Hemera API error ${status} (${statusText}) for ${url}`);
		this.name = "HemeraApiError";
	}
}

export class HemeraSeminarRecordingClient {
	private readonly baseUrl: string;
	private readonly getToken: () => Promise<string>;
	private readonly fetchFn: typeof fetch;
	private readonly maxRetries: number;

	constructor(options: HemeraSeminarRecordingClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.getToken = options.getToken;
		this.fetchFn = options.fetchFn ?? globalThis.fetch;
		this.maxRetries = options.maxRetries ?? 3;
	}

	private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
			try {
				const token = await this.getToken();
				const res = await this.fetchFn(url, {
					...init,
					headers: {
						"X-API-Key": token,
						Accept: "application/json",
						"Content-Type": "application/json",
						...(init.headers ?? {}),
					},
				});

				const body = await res.text();

				if (!res.ok) {
					const error = new HemeraApiError(res.status, res.statusText, body, url);
					// Retry only transient server errors
					if (res.status >= 500 && attempt < this.maxRetries) {
						lastError = error;
						continue;
					}
					throw error;
				}

				return schema.parse(JSON.parse(body));
			} catch (error) {
				if (error instanceof HemeraApiError) {
					throw error;
				}
				lastError = error instanceof Error ? error : new Error(String(error));
				if (attempt >= this.maxRetries) {
					throw lastError;
				}
			}
		}

		throw lastError ?? new Error(`Request to ${url} failed`);
	}

	/** GET /api/service/bookings/{bookingId} */
	async getBookingContext(bookingId: string): Promise<z.infer<typeof BookingContextSchema>> {
		return this.request(
			`/api/service/bookings/${encodeURIComponent(bookingId)}`,
			BookingContextSchema,
		);
	}

	/** GET /api/service/bookings/{bookingId}/seminar-recordings/{recordingId} */
	async getWorkflow(
		bookingId: string,
		recordingId: string,
	): Promise<z.infer<typeof SeminarRecordingWorkflowSchema>> {
		return this.request(
			`/api/service/bookings/${encodeURIComponent(bookingId)}/seminar-recordings/${encodeURIComponent(recordingId)}`,
			SeminarRecordingWorkflowSchema,
		);
	}

	/** PUT /api/service/bookings/{bookingId}/seminar-recordings/{recordingId} */
	async upsertWorkflow(
		bookingId: string,
		recordingId: string,
		update: WorkflowUpdate,
		idempotencyKey: string,
	): Promise<z.infer<typeof SeminarRecordingWorkflowSchema>> {
		return this.request(
			`/api/service/bookings/${encodeURIComponent(bookingId)}/seminar-recordings/${encodeURIComponent(recordingId)}`,
			SeminarRecordingWorkflowSchema,
			{
				method: "PUT",
				headers: { "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(update),
			},
		);
	}

	/** GET /api/service/seminar-recording-jobs?status=...&limit=... */
	async listJobs(
		statuses: WorkflowStatus[],
		limit = 20,
	): Promise<z.infer<typeof JobListingSchema>> {
		// OpenAPI style: form / explode: false -> literal comma-separated values
		const query = `status=${statuses.join(",")}&limit=${limit}`;
		return this.request(`/api/service/seminar-recording-jobs?${query}`, JobListingSchema);
	}
}
