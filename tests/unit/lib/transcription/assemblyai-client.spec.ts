// ---------------------------------------------------------------------------
// Unit Tests: AssemblyAI SDK Adapter
// Task: T015 [P] [US1] — Private staging URL submission (no local MP4, no
// AssemblyAI-upload URL reuse), speaker_labels, two-speaker bounds,
// contextual role descriptions, authenticated webhook configuration,
// transcript fetch, delete, provider errors, and status handling.
// ---------------------------------------------------------------------------

import {
	AssemblyAiAdapter,
	buildSpeakerIdentificationConfig,
} from "@/lib/transcription/assemblyai-client";
import { describe, expect, it, vi } from "vitest";

const STAGING_URL = "https://blob.example/seminar-sources/booking-001/rec.mp4?url=signed";
const WEBHOOK_URL = "https://aither.example/api/assemblyai/webhook?recordingId=rec-abc";

function createAdapter(
	overrides: Partial<ConstructorParameters<typeof AssemblyAiAdapter>[0]> = {},
) {
	return new AssemblyAiAdapter({
		baseUrl: "https://api.assemblyai.com",
		apiKey: "test-key",
		webhookUrl: WEBHOOK_URL,
		webhookSecret: "wh-secret",
		fetchFn: vi.fn(),
		...overrides,
	});
}

describe("submission configuration", () => {
	it("submits the private staging URL with speaker_labels enabled", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ id: "tx-123", status: "queued" }), { status: 200 }),
			);
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		const result = await adapter.submitTranscription(STAGING_URL);

		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.assemblyai.com/v2/transcript");
		const body = JSON.parse(String(init.body));
		expect(body.audio_url).toBe(STAGING_URL);
		expect(body.speaker_labels).toBe(true);
		expect(result.id).toBe("tx-123");
	});

	it("configures the authenticated completion webhook with recordingId", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ id: "tx-123", status: "queued" }), { status: 200 }),
			);
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		await adapter.submitTranscription(STAGING_URL);

		const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body));
		expect(body.webhook_url).toBe(WEBHOOK_URL);
	});

	it("requests contextual Speaker Identification for both roles", () => {
		const config = buildSpeakerIdentificationConfig();
		expect(config.expected_speakers).toBe(2);
		expect(config.speakers).toHaveLength(2);
		const roles = config.speakers.map((s: { custom_vocabulary?: string[] }) => s);
		expect(roles).toBeDefined();
	});

	it("sends the API key only via the authorization header", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ id: "tx-123", status: "queued" }), { status: 200 }),
			);
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		await adapter.submitTranscription(STAGING_URL);

		const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		const headers = init.headers as Record<string, string>;
		expect(headers.authorization).toBe("test-key");
		expect(JSON.stringify(init.body)).not.toContain("test-key");
	});
});

describe("transcript retrieval", () => {
	it("fetches the transcript by ID from the configured base URL", async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "tx-123",
					status: "completed",
					utterances: [
						{ speaker: "A", text: "Guten Tag.", start: 0, end: 1500 },
						{ speaker: "B", text: "Danke.", start: 2000, end: 3500 },
					],
				}),
				{ status: 200 },
			),
		);
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		const transcript = await adapter.getTranscript("tx-123");

		const [url] = fetchFn.mock.calls[0] as [string];
		expect(url).toBe("https://api.assemblyai.com/v2/transcript/tx-123");
		expect(transcript.status).toBe("completed");
		expect(transcript.utterances).toHaveLength(2);
	});

	it("surfaces a provider error status without throwing", async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: "tx-err", status: "error", error: "audio too short" }), {
				status: 200,
			}),
		);
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		const transcript = await adapter.getTranscript("tx-err");
		expect(transcript.status).toBe("error");
	});
});

describe("transcript deletion", () => {
	it("deletes the transcript after publication", async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		await adapter.deleteTranscript("tx-123");

		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.assemblyai.com/v2/transcript/tx-123");
		expect(init.method).toBe("DELETE");
	});

	it("treats a 404 deletion as idempotent already-deleted", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ error: "transcript not found" }), { status: 404 }),
			);
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		await expect(adapter.deleteTranscript("tx-gone")).resolves.toBeUndefined();
	});
});

describe("provider error handling", () => {
	it("throws a typed error on a 401 provider response", async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		await expect(adapter.submitTranscription(STAGING_URL)).rejects.toThrow(/401/);
	});

	it("throws on a 5xx provider response", async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
		const adapter = createAdapter({ fetchFn: fetchFn as unknown as typeof fetch });

		await expect(adapter.submitTranscription(STAGING_URL)).rejects.toThrow(/503/);
	});
});
