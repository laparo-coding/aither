// ---------------------------------------------------------------------------
// MUX Playback Reference Helpers (pure)
// Task: T029 (partial) — Stable non-bearer playback reference and full-video
// JWT TTL (FR-012/FR-021). The stable reference contains no signed token.
// ---------------------------------------------------------------------------

/** Buffer added on top of the video duration for the signed playback JWT. */
const MUX_TOKEN_TTL_BUFFER_SECONDS = 60;

/**
 * Builds the stable MUX playback reference handed directly to Hemera.
 * It MUST NOT contain a signed token or bearer credential (FR-008).
 */
export function buildStablePlaybackReference(playbackId: string): string {
	return `https://stream.mux.com/${playbackId}.m3u8`;
}

/**
 * Computes the signed playback JWT TTL so playback never interrupts:
 * at least the full video duration plus a buffer (FR-012).
 */
export function computeMuxTokenTtlSeconds(videoDurationSeconds: number): number {
	return videoDurationSeconds + MUX_TOKEN_TTL_BUFFER_SECONDS;
}
