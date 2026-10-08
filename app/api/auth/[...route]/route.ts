import { NextRequest, NextResponse } from "next/server";
import {
  OIDC_FLOW_COOKIE,
  SESSION_COOKIE,
  completeSignIn,
  encodeSessionCookie,
  flowCookieOptions,
  sessionCookieOptions,
  startSignIn,
} from "@/src/lib/auth";

export const dynamic = "force-dynamic";

/**
 * OneLogin OIDC endpoints (Authorization Code + PKCE):
 *   GET /api/auth/login?returnTo=/brands   — redirects to OneLogin
 *   GET /api/auth/callback                 — exchanges the code, sets the session
 *   GET /api/auth/logout                   — clears the session
 */
export async function GET(request: NextRequest, context: { params: Promise<{ route: string[] }> }) {
  const { route } = await context.params;
  const step = route?.[0];

  if (step === "login") {
    const returnTo = request.nextUrl.searchParams.get("returnTo") || "/brands";
    const redirectUri = new URL("/api/auth/callback", request.nextUrl.origin).toString();

    let authorizationUrl: URL;
    let flowCookieValue: string;
    try {
      ({ authorizationUrl, flowCookieValue } = await startSignIn(redirectUri, returnTo));
    } catch (error) {
      return oidcUnavailableResponse(error);
    }

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OIDC_FLOW_COOKIE, flowCookieValue, flowCookieOptions());
    return response;
  }

  if (step === "callback") {
    const flowCookieValue = request.cookies.get(OIDC_FLOW_COOKIE)?.value;
    try {
      const { user, returnTo } = await completeSignIn(new URL(request.url), flowCookieValue);
      const response = NextResponse.redirect(new URL(returnTo, request.nextUrl.origin));
      response.cookies.set(SESSION_COOKIE, encodeSessionCookie(user), sessionCookieOptions());
      response.cookies.delete(OIDC_FLOW_COOKIE);
      return response;
    } catch (error) {
      return oidcUnavailableResponse(error);
    }
  }

  if (step === "logout") {
    const response = NextResponse.redirect(new URL("/", request.nextUrl.origin));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * OneLogin's discovery URL/client credentials are a pending IT Helpdesk
 * request in this environment (implementation-plan.md, "Credential-blocked
 * epics"). Surface that plainly instead of a generic 500.
 */
function oidcUnavailableResponse(error: unknown) {
  console.error("OneLogin sign-in failed", error);
  return NextResponse.json(
    {
      error:
        "Sign-in is not available yet: the OneLogin connection has not been configured in this environment.",
    },
    { status: 503 },
  );
}
