import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { ErrorSeverity, reportError } from "@/lib/monitoring/rollbar-official";
import {
	navigatePresentation,
	toControllerErrorResponse,
} from "@/lib/slides/controller-navigation";
import { parseControllerNavigationRequest } from "@/lib/slides/controller-types";
import { NextResponse } from "next/server";

function toInvalidRequestResponse(message: string, requestId: string) {
	return NextResponse.json(
		{
			success: false,
			error: {
				code: "INVALID_REQUEST",
				message,
				requestId,
			},
		},
		{ status: 400 },
	);
}

export async function POST(req: Request) {
	const requestId = req.headers.get("x-request-id") ?? randomUUID();
	const authData = await getRouteAuth();
	const authResult = requireAdmin(authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	let payload: unknown;
	try {
		payload = await req.json();
	} catch {
		return toInvalidRequestResponse("Invalid JSON body", requestId);
	}

	let navigationRequest: ReturnType<typeof parseControllerNavigationRequest>;
	try {
		navigationRequest = parseControllerNavigationRequest(payload);
	} catch {
		return toInvalidRequestResponse("Invalid navigation request", requestId);
	}

	try {
		const result = await navigatePresentation(navigationRequest);
		return NextResponse.json({ success: true, data: result }, { status: 200 });
	} catch (error) {
		const mapped = toControllerErrorResponse(error, requestId);
		if (mapped.status >= 500) {
			reportError(
				error instanceof Error ? error : new Error(String(error)),
				{
					requestId,
					route: "/api/slides/controller/navigation",
					method: "POST",
					additionalData: {
						errorCategory: "controller",
						severity: "error",
						code: mapped.body.error.code,
					},
				},
				ErrorSeverity.ERROR,
			);
		}
		return NextResponse.json(mapped.body, { status: mapped.status });
	}
}
