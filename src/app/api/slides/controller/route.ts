import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/auth/role-check";
import { getRouteAuth } from "@/lib/auth/route-auth";
import { ErrorSeverity, reportError } from "@/lib/monitoring/rollbar-official";
import { isControllerDomainError, loadControllerManifest } from "@/lib/slides/controller-manifest";
import { parseCourseId } from "@/lib/slides/controller-types";
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

export async function GET(req: Request) {
	const requestId = req.headers.get("x-request-id") ?? randomUUID();
	const authData = await getRouteAuth();
	const authResult = requireAdmin(authData);
	if (authResult.status !== 200) {
		return NextResponse.json(authResult.body, { status: authResult.status });
	}

	const url = new URL(req.url);
	let courseId: string;
	const rawCourseId = url.searchParams.get("courseId");
	if (rawCourseId === null) {
		return toInvalidRequestResponse("Invalid courseId", requestId);
	}
	try {
		courseId = parseCourseId(rawCourseId);
	} catch {
		return toInvalidRequestResponse("Invalid courseId", requestId);
	}

	try {
		const manifest = await loadControllerManifest(courseId);
		return NextResponse.json({ success: true, data: manifest }, { status: 200 });
	} catch (error) {
		if (isControllerDomainError(error)) {
			if (error.status >= 500) {
				reportError(
					error,
					{
						requestId,
						route: "/api/slides/controller",
						method: "GET",
						additionalData: {
							errorCategory: "controller",
							severity: "error",
							code: error.code,
						},
					},
					ErrorSeverity.ERROR,
				);
			}
			return NextResponse.json(
				{
					success: false,
					error: {
						code: error.code,
						message: error.message,
						requestId,
						details: error.details,
					},
				},
				{ status: error.status },
			);
		}

		reportError(
			error instanceof Error ? error : new Error(String(error)),
			{
				requestId,
				route: "/api/slides/controller",
				method: "GET",
				additionalData: {
					errorCategory: "controller",
					severity: "error",
					code: "INTERNAL_ERROR",
				},
			},
			ErrorSeverity.ERROR,
		);

		return NextResponse.json(
			{
				success: false,
				error: {
					code: "INTERNAL_ERROR",
					message: "Unexpected controller error.",
					requestId,
				},
			},
			{ status: 500 },
		);
	}
}
