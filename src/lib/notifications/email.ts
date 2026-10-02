// ---------------------------------------------------------------------------
// Email Notification Service — Nodemailer
// Task: T041 [US3] — Threshold-based sending, failure counter
// ---------------------------------------------------------------------------

import { loadConfig } from "@/lib/config";
import nodemailer, { type Transporter } from "nodemailer";

let failureCount = 0;

/** Lazily created transport — avoids reading env at module load time. */
let _transport: Transporter | null = null;

function getTransport(): Transporter {
	if (_transport) return _transport;
	const cfg = loadConfig();
	// secure: true für Port 465 (SMTPS), sonst aus Config oder false
	const secure = cfg.SMTP_SECURE ?? cfg.SMTP_PORT === 465;
	_transport = nodemailer.createTransport({
		host: cfg.SMTP_HOST,
		port: cfg.SMTP_PORT,
		secure,
		auth: {
			user: cfg.SMTP_USER,
			pass: cfg.SMTP_PASS,
		},
	});
	return _transport;
}

export async function sendFailureNotification(jobId: string, errorSummary: string): Promise<void> {
	const cfg = loadConfig();
	failureCount++;
	if (failureCount < cfg.NOTIFY_FAILURE_THRESHOLD) return;

	const mailOptions = {
		from: cfg.SMTP_FROM,
		to: cfg.SMTP_TO ?? cfg.NOTIFY_EMAIL_TO,
		subject: `Aither Sync Failure Notification (job ${jobId})`,
		text: `Sync job ${jobId} failed.\n\nError summary: ${errorSummary}\n\nTimestamp: ${new Date().toISOString()}`,
	};

	try {
		await getTransport().sendMail(mailOptions);
		// Counter nicht zurücksetzen - weiterhin E-Mails bei jedem Fehler senden
	} catch (err) {
		// Redaktiere Empfängeradresse für Logging
		const sanitizedMailOptions = {
			...mailOptions,
			to: Array.isArray(mailOptions.to)
				? `[${mailOptions.to.length} Empfänger]`
				: mailOptions.to
					? "[REDACTED]"
					: undefined,
		};
		// Fehlertext extrahieren
		const msg = String(
			err && typeof err === "object" && "message" in err
				? (err as unknown as { message?: string }).message
				: err,
		);
		// eslint-disable-next-line no-console
		console.error("[Email] Fehler beim Senden der Sync-Failure-Mail:", msg, {
			jobId,
			mail: sanitizedMailOptions,
		});
		// failureCount bleibt erhöht, damit bei erneutem Fehler wieder versucht wird
		throw err;
	}
}

export function resetFailureCounter(): void {
	failureCount = 0;
}

export function getFailureCount(): number {
	return failureCount;
}

export function _resetForTesting(): void {
	failureCount = 0;
	_transport = null;
}
