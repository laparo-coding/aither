// ---------------------------------------------------------------------------
// Route Auth Wrapper — Clerk v6 auth() for App Router route handlers
// Provides a single mockable entry point for all API routes.
// ---------------------------------------------------------------------------

/**
 * Retrieve session auth context in a route handler.
 *
 * Delegates to Clerk's `auth()` which reads session state
 * set by `clerkMiddleware` (src/proxy.ts).
 *
 * Returns `null` when no user is signed in, otherwise the
 * full Clerk session object including `sessionClaims`.
 *
 * In development with the explicit bypass flag, returns a mock admin session
 * so local routes work without an interactive sign-in.
 */
export async function getRouteAuth(): Promise<unknown> {
	if (process.env.NODE_ENV === "development" && process.env.ENABLE_DEV_AUTH_BYPASS === "true") {
		console.warn("[route-auth] Dev auth bypass is active — returning mock admin session");
		return {
			userId: "dev-user",
			sessionClaims: { metadata: { role: "admin" } },
		};
	}

	const { auth } = await import("@clerk/nextjs/server");
	const session = await auth();
	return session?.userId ? session : null;
}
