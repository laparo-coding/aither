import type { HemeraSeminarRecordingClient } from "./hemera-seminar-client";
import type { AssemblyAiCallback, WorkflowUpdate } from "./types";

export type CallbackReconciliation = "updated" | "stale-transcript" | "workflow-advanced";

const CALLBACK_PROTECTED_STATUSES = new Set([
	"review_required",
	"publishing",
	"ready",
	"deletion_pending",
	"deleted",
	"failed",
]);

/** Applies a provider callback only while its transcript is the active canonical job. */
export async function reconcileAssemblyAiCallback(
	hemera: Pick<HemeraSeminarRecordingClient, "getWorkflow" | "upsertWorkflow">,
	bookingId: string,
	recordingId: string,
	callback: AssemblyAiCallback,
): Promise<CallbackReconciliation> {
	const workflow = await hemera.getWorkflow(bookingId, recordingId);
	if (workflow.assemblyAiTranscriptId !== callback.transcript_id) {
		return "stale-transcript";
	}
	if (CALLBACK_PROTECTED_STATUSES.has(workflow.status)) {
		return "workflow-advanced";
	}
	if (!["queued", "transcribing", "retryable_failure"].includes(workflow.status)) {
		return "workflow-advanced";
	}

	const completed = callback.status === "completed";
	const update: WorkflowUpdate = {
		status: completed ? "transcript_ready" : "failed",
		recordingDate: workflow.recordingDate,
		assemblyAiStatus: callback.status,
		nextAttemptAt: null,
		...(completed ? {} : { lastErrorCode: "assemblyai_callback_error" }),
	};
	await hemera.upsertWorkflow(
		bookingId,
		recordingId,
		update,
		`${bookingId}:${recordingId}:assemblyai_callback:${callback.transcript_id}:${callback.status}`,
	);
	return "updated";
}
