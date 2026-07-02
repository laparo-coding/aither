"use client";

import type { ServiceParticipant } from "@/lib/hemera/schemas";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Grid from "@mui/material/Grid";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useCallback, useMemo, useRef, useState } from "react";

const AVATAR_COLORS = [
	"#884143",
	"#926A49",
	"#bc8f8f",
	"#5B9A8B",
	"#2D2D2D",
	"#6B4C3B",
	"#7A8B6F",
	"#8B6F7A",
];

function getAvatarColor(name: string | null): string {
	if (!name) return AVATAR_COLORS[0];
	const sum = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
	return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function getInitials(name: string | null): string {
	if (!name || !name.trim()) return "?";
	const parts = name.trim().split(/\s+/).filter(Boolean);
	const first = parts[0]?.[0] ?? "";
	const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
	const initials = `${first}${last}`.toUpperCase();
	return initials || "?";
}

interface ParticipantsListProps {
	participants: ServiceParticipant[];
	hemeraBaseUrl?: string;
}

/**
 * Labels matching Hemera's aria-labels (app/my-courses/MyCoursesClient.tsx).
 * Keep in sync when Hemera renames fields.
 */
const PREPARATION_LABELS = {
	preparationIntent: "Vorbereitungsabsicht",
	desiredResults: "Gewünschte Ergebnisse",
	lineManagerProfile: "Profil des Vorgesetzten",
} as const;

function normalizeHemeraBaseUrl(hemeraBaseUrl?: string): string | undefined {
	if (!hemeraBaseUrl) return undefined;
	try {
		const parsed = new URL(hemeraBaseUrl);
		const normalizedPath = parsed.pathname.replace(/\/+$/, "");
		return `${parsed.origin}${normalizedPath}`;
	} catch {
		return undefined;
	}
}

export function ParticipantsList({ participants, hemeraBaseUrl }: ParticipantsListProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const toggleRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const list = useMemo(
		() =>
			[...participants].sort((a, b) => {
				const na = a.name?.trim()?.toLowerCase() || "";
				const nb = b.name?.trim()?.toLowerCase() || "";
				const aMissing = na === "";
				const bMissing = nb === "";
				if (aMissing && bMissing) return 0;
				if (aMissing) return 1;
				if (bMissing) return -1;
				return na.localeCompare(nb, "de");
			}),
		[participants],
	);
	const normalizedBaseUrl = useMemo(() => normalizeHemeraBaseUrl(hemeraBaseUrl), [hemeraBaseUrl]);

	const focusToggle = useCallback((index: number) => {
		toggleRefs.current[index]?.focus();
	}, []);

	const handleToggle = useCallback((participationId: string | null) => {
		if (!participationId) return;
		setExpandedId((current) => (current === participationId ? null : participationId));
	}, []);

	const handleToggleKeyDown = useCallback(
		(
			event: React.KeyboardEvent<HTMLButtonElement>,
			index: number,
			participationId: string | null,
		) => {
			switch (event.key) {
				case "Enter":
				case " ":
				case "Space":
				case "Spacebar":
					event.preventDefault();
					handleToggle(participationId);
					break;
				case "ArrowDown":
					event.preventDefault();
					focusToggle((index + 1) % list.length);
					break;
				case "ArrowUp":
					event.preventDefault();
					focusToggle((index - 1 + list.length) % list.length);
					break;
				case "Home":
					event.preventDefault();
					focusToggle(0);
					break;
				case "End":
					event.preventDefault();
					focusToggle(list.length - 1);
					break;
				case "Escape":
					if (expandedId === participationId) {
						event.preventDefault();
						setExpandedId(null);
						focusToggle(index);
					}
					break;
			}
		},
		[expandedId, focusToggle, handleToggle, list.length],
	);

	const handlePanelKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setExpandedId(null);
				focusToggle(index);
			}
		},
		[focusToggle],
	);

	return (
		<Card data-testid="participants-list" sx={{ mb: 4 }}>
			<CardContent>
				<Typography variant="h6" gutterBottom>
					Teilnehmer &amp; Vorbereitungen
				</Typography>

				{list.length === 0 ? (
					<Typography color="text.secondary">Keine Teilnehmer.</Typography>
				) : (
					<Grid container spacing={2}>
						{list.map((participant, index) => {
							const name = participant.name || "Unbekannt";
							const isExpanded = expandedId === participant.participationId;
							const buttonId = `participant-toggle-${participant.participationId}`;
							const regionId = `participant-panel-${participant.participationId}`;
							const href =
								normalizedBaseUrl && participant.bookingId
									? `${normalizedBaseUrl}/my-courses/${encodeURIComponent(participant.bookingId)}`
									: undefined;

							return (
								<Grid key={participant.participationId} size={{ xs: 12, md: 6 }}>
									<Paper sx={{ p: 2, height: "100%" }}>
										<Box
											component="button"
											type="button"
											id={buttonId}
											ref={(element: HTMLButtonElement | null) => {
												toggleRefs.current[index] = element;
											}}
											onClick={() => handleToggle(participant.participationId)}
											onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) =>
												handleToggleKeyDown(event, index, participant.participationId)
											}
											aria-expanded={isExpanded}
											aria-controls={regionId}
											aria-label={`Teilnehmerdetails für ${name} umschalten`}
											sx={{
												all: "unset",
												display: "flex",
												alignItems: "center",
												gap: 1.5,
												mb: 1.5,
												width: "100%",
												cursor: "pointer",
												borderRadius: 1,
												"&:focus-visible": {
													outline: "2px solid currentColor",
													outlineOffset: 2,
												},
											}}
										>
											<Avatar
												sx={{
													bgcolor: getAvatarColor(participant.name),
													width: 40,
													height: 40,
													fontSize: 16,
													fontWeight: 600,
													flexShrink: 0,
													border: "2px solid rgba(255,255,255,0.3)",
												}}
												src={participant.imageUrl ?? undefined}
												alt={name}
											>
												{getInitials(participant.name)}
											</Avatar>
											<Typography
												variant="body1"
												sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}
												noWrap
											>
												{name}
											</Typography>
											<Chip
												size="small"
												label={participant.preparationCompletedAt ? "Abgeschlossen" : "Offen"}
												color={participant.preparationCompletedAt ? "success" : "default"}
											/>
										</Box>

										<Collapse in={isExpanded} timeout="auto" unmountOnExit>
											<Box
												component="section"
												id={regionId}
												aria-labelledby={buttonId}
												onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) =>
													handlePanelKeyDown(event, index)
												}
												sx={{ display: "grid", gap: 1 }}
											>
												{(
													["preparationIntent", "desiredResults", "lineManagerProfile"] as const
												).map((field) => {
													const label = PREPARATION_LABELS[field];
													const rawValue = participant[field];
													const value = typeof rawValue === "string" ? rawValue.trim() : "";
													const text = value || (href ? "Vorbereitung ansehen" : label);
													return (
														<Box key={field}>
															<Typography
																variant="caption"
																sx={{ display: "block", color: "text.secondary" }}
															>
																{label}
															</Typography>
															<Typography variant="body2">
																{href ? (
																	<Link href={href} target="_blank" rel="noopener noreferrer">
																		{text}
																	</Link>
																) : (
																	text
																)}
															</Typography>
														</Box>
													);
												})}
											</Box>
										</Collapse>
									</Paper>
								</Grid>
							);
						})}
					</Grid>
				)}
			</CardContent>
		</Card>
	);
}
