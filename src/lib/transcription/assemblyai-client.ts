// ---------------------------------------------------------------------------
// AssemblyAI SDK Adapter
// Task: T021 [US1] — Asynchronous submission from a private staged-media URL,
// authenticated webhook metadata, transcript fetch, and transcript deletion.
// Uses the explicitly configured ASSEMBLY_AI_BASE_URL; never falls back to a
// different endpoint and never reuses an AssemblyAI-upload URL as MUX input.
// ---------------------------------------------------------------------------

export interface AssemblyAiAdapterOptions {
	baseUrl: string;
	apiKey: string;
	/** Public webhook URL including the recordingId query parameter. */
	webhookUrl: string;
	webhookSecret: string;
	fetchFn?: typeof fetch;
}

export interface AssemblyAiUtterance {
	speaker: string;
	text: string;
	start: number;
	end: number;
}

export interface AssemblyAiTranscript {
	id: string;
	status: string;
	error?: string;
	utterances?: AssemblyAiUtterance[];
	speech_model?: string;
}

export class AssemblyAiProviderError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(`AssemblyAI error ${status}: ${message}`);
		this.name = "AssemblyAiProviderError";
	}
}

/** Contextual Speaker Identification config for the two seminar roles. */
export function buildSpeakerIdentificationConfig() {
	return {
		expected_speakers: 2,
		speakers: [
			{
				speaker_type: "role" as const,
				custom_vocabulary: ["Seminarleiter"],
				keyterms_prompt:
					"The seminar leader opens the session, gives instructions, and guides the discussion.",
			},
			{
				speaker_type: "role" as const,
				custom_vocabulary: ["Teilnehmerin"],
				keyterms_prompt: "The participant replies, asks questions, and engages in the discussion.",
			},
		],
	};
}

export class AssemblyAiAdapter {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly webhookUrl: string;
	private readonly webhookSecret: string;
	private readonly fetchFn: typeof fetch;

	constructor(options: AssemblyAiAdapterOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.webhookUrl = options.webhookUrl;
		this.fetchFn = options.fetchFn ?? globalThis.fetch;

		// Webhook secret is required for secure callback verification
		this.webhookSecret = options.webhookSecret ?? "";
		if (!this.webhookSecret) {
			throw new Error(
				"AssemblyAiAdapter: webhookSecret is required for secure webhook authentication",
			);
		}
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const res = await this.fetchFn(`${this.baseUrl}${path}`, {
			...init,
			headers: {
				authorization: this.apiKey,
				"Content-Type": "application/json",
				...(init.headers ?? {}),
			},
		});

		if (!res.ok) {
			throw new AssemblyAiProviderError(res.status, await res.text());
		}

		if (res.status === 204) {
			return undefined as T;
		}
		return (await res.json()) as T;
	}

	/** Submits an async transcription job from a scoped private staging URL. */
	async submitTranscription(stagedMediaUrl: string): Promise<{ id: string; status: string }> {
		const body = {
			audio_url: stagedMediaUrl,
			speaker_labels: true,
			speech_model: "best",
			webhook_url: this.webhookUrl,
			webhook_auth_type: "signing_secret" as const,
			webhook_auth_secret: this.webhookSecret,
			speaker_identification: {
				...buildSpeakerIdentificationConfig(),
				speaker_type: "role" as const,
			},
		};
		return this.request<{ id: string; status: string }>("/v2/transcript", {
			method: "POST",
			body: JSON.stringify(body),
		});
	}

	/** Fetches the transcript result by ID. */
	async getTranscript(transcriptId: string): Promise<AssemblyAiTranscript> {
		return this.request<AssemblyAiTranscript>(`/v2/transcript/${transcriptId}`);
	}

	/** Deletes the transcript; a 404 is treated as idempotent already-deleted. */
	async deleteTranscript(transcriptId: string): Promise<void> {
		try {
			await this.request<void>(`/v2/transcript/${transcriptId}`, {
				method: "DELETE",
			});
		} catch (error) {
			if (error instanceof AssemblyAiProviderError && error.status === 404) {
				return;
			}
			throw error;
		}
	}
}
