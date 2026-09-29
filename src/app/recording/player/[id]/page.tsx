"use client";

// ---------------------------------------------------------------------------
// Full-Screen HD Web Player
// Task: T030 [US4] — Client component, <video> fills viewport at 1920×1080,
//                    no controls, black background, SSE EventSource, handle
//                    play/stop/seek commands, POST state reports back
// Task: T013 [US1] (Spec 011) — Fetch chapters on mount (cookie-based auth),
//                    seek to chapters[0].start on first play command (client-side)
// Task: T024 [US2] (Spec 011) — Next Timestamp button + "N" keyboard shortcut,
//                    minimal overlay icon (bottom-right, hover/key-press visible)
// ---------------------------------------------------------------------------

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { nextTimestamp } from "@/lib/recording/chapter-seek-logic";
import type { ChapterSummary } from "@/lib/recording/types";

type SSECommand = { action: "play" } | { action: "stop" } | { action: "seek"; position: number };

function chapterAtPosition(
	chapters: ChapterSummary[],
	position: number,
): ChapterSummary | undefined {
	return chapters.find((chapter) => position >= chapter.start && position < chapter.end);
}

export default function RecordingPlayerPage() {
	const params = useParams<{ id: string }>();
	const id = params.id;

	const videoRef = useRef<HTMLVideoElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);

	// Chapter navigation state (Spec 011)
	const [chapters, setChapters] = useState<ChapterSummary[]>([]);
	const [chaptersLoaded, setChaptersLoaded] = useState(false);
	const [chaptersNotGenerated, setChaptersNotGenerated] = useState(false);
	const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
	const [overlayVisible, setOverlayVisible] = useState(false);
	const [, forceUpdate] = useState(0);
	const activeChapterIdRef = useRef<number | null>(null);

	// Report player state back to the server
	const reportState = useCallback(
		async (state: string, position: number, errorMessage?: string) => {
			try {
				await fetch("/api/recording/playback/state", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						recordingId: id,
						state,
						position,
						...(errorMessage ? { message: errorMessage } : {}),
					}),
				});
			} catch {
				// Silently fail — state reports are best-effort
			}
		},
		[id],
	);

	// Fetch chapters on mount (Spec 011, FR-001 — cookie-based auth, parallel to video load)
	useEffect(() => {
		if (!id) return;

		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/recording/chapters/${id}`);
				if (cancelled) return;
				if (res.status === 200) {
					const data = await res.json();
					const chapterList = data.data ?? data;
					setChapters(chapterList.chapters ?? []);
					setChaptersLoaded(true);
				} else if (res.status === 404) {
					// CHAPTERS_NOT_GENERATED — silent fallback to headless
					setChaptersNotGenerated(true);
					setChaptersLoaded(true);
				} else {
					// 401 or other — silent fallback to headless (no error UI)
					setChaptersLoaded(true);
				}
			} catch {
				if (!cancelled) {
					// Network error — silent fallback to headless
					setChaptersLoaded(true);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [id]);

	// Next Timestamp action (client-side seek, FR-003)
	const seekToNextTimestamp = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (!chaptersLoaded || chapters.length === 0) return;

		const next = nextTimestamp(chapters, video.currentTime);
		if (next) {
			video.currentTime = next.start;
			activeChapterIdRef.current = next.id;
			// Briefly show overlay as feedback
			setOverlayVisible(true);
			window.setTimeout(() => setOverlayVisible(false), 3000);
			// Force re-render so button disabled state updates
			forceUpdate((n) => n + 1);
		}
	}, [chapters, chaptersLoaded]);

	// Keyboard shortcut "N" (FR-003, NFR-003)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() === "n") {
				seekToNextTimestamp();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [seekToNextTimestamp]);

	useEffect(() => {
		if (!id) {
			setError("No recording ID provided");
			return;
		}

		const video = videoRef.current;
		if (!video) return;
		if (
			chapters.length > 0 &&
			activeChapterIdRef.current === null &&
			(hasPlayedOnce || !video.paused)
		) {
			activeChapterIdRef.current = chapterAtPosition(chapters, video.currentTime)?.id ?? null;
		}

		// Set video source to the streaming endpoint
		video.src = `/api/recording/stream/${id}`;

		// Connect to SSE events
		const eventSource = new EventSource(`/api/recording/events?recordingId=${id}`);

		eventSource.addEventListener("connected", () => {
			setConnected(true);
		});

		eventSource.addEventListener("command", (event) => {
			try {
				const command: SSECommand = JSON.parse(event.data);

				switch (command.action) {
					case "play":
						// Spec 011 FR-002: on first play, seek to chapters[0].start (client-side only)
						if (!hasPlayedOnce && chapters.length > 0) {
							const firstChapter = chapters[0];
							video.currentTime = firstChapter.start;
							activeChapterIdRef.current = firstChapter.id;
						} else if (activeChapterIdRef.current === null) {
							activeChapterIdRef.current =
								chapterAtPosition(chapters, video.currentTime)?.id ?? null;
						}
						setHasPlayedOnce(true);
						video.play().catch((err) => {
							setError(`Playback failed: ${err.message}`);
							reportState("error", video.currentTime, err.message);
						});
						break;
					case "stop":
						video.pause();
						break;
					case "seek":
						video.currentTime = command.position;
						activeChapterIdRef.current = chapterAtPosition(chapters, command.position)?.id ?? null;
						break;
				}
			} catch {
				// Invalid SSE data — ignore
			}
		});

		eventSource.onerror = () => {
			setConnected(false);
		};

		// Video event listeners for state reporting
		const onPlay = () => {
			if (activeChapterIdRef.current === null) {
				activeChapterIdRef.current = chapterAtPosition(chapters, video.currentTime)?.id ?? null;
			}
			reportState("playing", video.currentTime);
		};
		const onPause = () => reportState("paused", video.currentTime);
		const onEnded = () => reportState("ended", video.currentTime);
		const onSeeking = () => {
			activeChapterIdRef.current = chapterAtPosition(chapters, video.currentTime)?.id ?? null;
		};
		const onError = () => {
			const msg = "Video playback error";
			setError(msg);
			reportState("error", video.currentTime, msg);
		};
		let lastReportTimestamp = 0;
		const onTimeUpdate = () => {
			const activeChapter = chapters.find((chapter) => chapter.id === activeChapterIdRef.current);
			if (activeChapter && video.currentTime >= activeChapter.end) {
				video.currentTime = activeChapter.end;
				activeChapterIdRef.current = null;
				video.pause();
				return;
			}

			const now = Date.now();
			if (now - lastReportTimestamp >= 2000) {
				lastReportTimestamp = now;
				reportState(video.paused ? "paused" : "playing", video.currentTime);
				// Force re-render so button disabled state updates with position
				forceUpdate((n) => n + 1);
			}
		};

		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onPause);
		video.addEventListener("ended", onEnded);
		video.addEventListener("seeking", onSeeking);
		video.addEventListener("error", onError);
		video.addEventListener("timeupdate", onTimeUpdate);

		return () => {
			eventSource.close();
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
			video.removeEventListener("ended", onEnded);
			video.removeEventListener("seeking", onSeeking);
			video.removeEventListener("error", onError);
			video.removeEventListener("timeupdate", onTimeUpdate);
		};
	}, [id, reportState, chapters, hasPlayedOnce]);

	// Compute next chapter availability for button disabled state (FR-004, FR-004a)
	const video = videoRef.current;
	const currentPosition = video?.currentTime ?? 0;
	const hasNextTimestamp =
		chaptersLoaded && chapters.length > 0 && nextTimestamp(chapters, currentPosition) !== null;
	const isButtonDisabled = !hasNextTimestamp || chaptersNotGenerated;

	// Mouse movement handler — show overlay on hover (NFR-003)
	const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const onMouseMove = useCallback(() => {
		setOverlayVisible(true);
		if (overlayTimeoutRef.current) {
			clearTimeout(overlayTimeoutRef.current);
		}
		overlayTimeoutRef.current = setTimeout(() => {
			setOverlayVisible(false);
		}, 3000);
	}, []);

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				width: "100vw",
				height: "100vh",
				backgroundColor: "#000",
				margin: 0,
				padding: 0,
				overflow: "hidden",
			}}
			onMouseMove={onMouseMove}
		>
			{error ? (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: "100%",
						height: "100%",
						color: "#fff",
						fontFamily: "system-ui, sans-serif",
						fontSize: "1.5rem",
					}}
				>
					{error}
				</div>
			) : (
				<video
					ref={videoRef}
					style={{
						width: "100%",
						height: "100%",
						objectFit: "contain",
					}}
					playsInline
					preload="auto"
				>
					<track kind="captions" />
				</video>
			)}
			{!connected && !error && (
				<div
					style={{
						position: "absolute",
						top: 16,
						right: 16,
						color: "#666",
						fontFamily: "system-ui, sans-serif",
						fontSize: "0.75rem",
					}}
				>
					Connecting…
				</div>
			)}
			{/* Next Timestamp button — minimal overlay (Spec 011, FR-003, NFR-003) */}
			{!error && (overlayVisible || isButtonDisabled) && (
				<div
					style={{
						position: "absolute",
						bottom: 16,
						right: 16,
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-end",
						gap: 4,
						opacity: isButtonDisabled ? 0.4 : 0.7,
						transition: "opacity 0.3s",
					}}
				>
					<button
						type="button"
						disabled={isButtonDisabled}
						onClick={seekToNextTimestamp}
						style={{
							background: "rgba(255,255,255,0.15)",
							border: "1px solid rgba(255,255,255,0.3)",
							borderRadius: 8,
							color: "#fff",
							cursor: isButtonDisabled ? "default" : "pointer",
							fontFamily: "system-ui, sans-serif",
							fontSize: "0.85rem",
							padding: "8px 14px",
						}}
					>
						▶▶ Nächster Timestamp
					</button>
					{chaptersNotGenerated && (
						<span
							style={{
								color: "#999",
								fontFamily: "system-ui, sans-serif",
								fontSize: "0.7rem",
							}}
						>
							Kapitel noch nicht generiert. Bitte zuerst regenerieren.
						</span>
					)}
				</div>
			)}
		</div>
	);
}
