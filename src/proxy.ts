// ---------------------------------------------------------------------------
// Clerk Proxy — Route Protection (Next.js 14+)
// Task: T016 — Protect /api/sync, /api/recordings, /(dashboard)/** routes
// ---------------------------------------------------------------------------

import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const hasClerkKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_");

function timingSafeEqualString(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const maxLength = Math.max(leftBytes.length, rightBytes.length);
	let diff = leftBytes.length ^ rightBytes.length;

	for (let index = 0; index < maxLength; index += 1) {
		const leftByte = leftBytes[index] ?? 0;
		const rightByte = rightBytes[index] ?? 0;
		diff |= leftByte ^ rightByte;
	}

	return diff === 0;
}

const protectedPatterns = [
	"/api/sync(.*)",
	"/api/recordings(.*)",
	"/api/recording(.*)",
	"/sync(.*)",
	"/recording(.*)",
	"/api/service/(.*)",
	"/dashboard(.*)",
];

// Public routes that match a protected pattern but should bypass auth
const publicPaths = new Set([
	"/api/recording/snapshot",
	"/api/recording/start",
	"/api/recording/stop",
	"/api/recording/status",
	"/api/recording/list",
	"/api/recording/events",
	"/api/recording/playback/play",
	"/api/recording/playback/stop",
	"/api/recording/playback/rewind",
	"/api/recording/playback/forward",
	"/api/recording/playback/state",
]);

const protectedRegexes = protectedPatterns.map((p) => new RegExp(`^${p}$`));

function isProtectedPath(pathname: string): boolean {
	if (publicPaths.has(pathname)) return false;
	return protectedRegexes.some((re) => re.test(pathname));
}

function extractBearerToken(req: NextRequest): string | null {
	const authorization = req.headers.get("authorization");
	if (!authorization) {
		return null;
	}

	const [scheme, token] = authorization.split(" ", 2);
	if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
		return null;
	}

	return token;
}

export function isAuthorizedSyncServiceRequest(req: NextRequest): boolean {
	if (req.nextUrl.pathname !== "/api/sync") {
		return false;
	}

	const expectedToken = process.env.AITHER_SYNC_TOKEN;
	const bearerToken = extractBearerToken(req);

	if (!expectedToken || !bearerToken) {
		return false;
	}

	return timingSafeEqualString(bearerToken, expectedToken);
}

// Cache clerk handler promise to deduplicate concurrent initialization
let _clerkHandlerPromise: Promise<
	(req: NextRequest, ev: NextFetchEvent) => Promise<Response>
> | null = null;

async function getClerkHandler(): Promise<
	(req: NextRequest, ev: NextFetchEvent) => Promise<Response>
> {
	if (!_clerkHandlerPromise) {
		_clerkHandlerPromise = (async () => {
			try {
				const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");

				const isProtectedRoute = createRouteMatcher(protectedPatterns);

				const handler = clerkMiddleware(async (auth, r) => {
					if (isAuthorizedSyncServiceRequest(r)) {
						return NextResponse.next();
					}

					if (isProtectedRoute(r) && !publicPaths.has(r.nextUrl.pathname)) {
						await auth.protect();
					}
				});

				return (r: NextRequest, ev: NextFetchEvent) => handler(r, ev) as Promise<Response>;
			} catch (err) {
				_clerkHandlerPromise = null;
				throw err;
			}
		})();
	}
	return _clerkHandlerPromise;
}

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
	if (!hasClerkKey) {
		if (isProtectedPath(req.nextUrl.pathname)) {
			console.error(
				"[proxy] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing — blocking protected route %s",
				req.nextUrl.pathname,
			);
			return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
		}
		return NextResponse.next();
	}
	const handler = await getClerkHandler();
	return handler(req, ev);
}

export const config = {
	matcher: [
		// Skip Next.js internals and static files, unless found in search params
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
