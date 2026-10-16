import { NextRequest, NextResponse } from "next/server";
import {
  OIDC_FLOW_COOKIE,
  SESSION_COOKIE,
  completeSignIn,
  flowCookieOptions,
  sessionCookieOptions,
  startSignIn,
} from "@/src/lib/auth";
import { createAuthSession, revokeAuthSession } from "@/src/db/queries/auth_sessions";
import { safeReturnPath } from "@/src/lib/authTokens";

export const dynamic = "force-dynamic";

/**
 * OneLogin OIDC endpoints (Authorization Code + PKCE):
 *   GET /api/auth/login?returnTo=/brands   — redirects to OneLogin
 *   GET /api/auth/callback                 — exchanges the code, sets the session
 *   POST /api/auth/logout                  — revokes and clears the session
 */
export async function GET(request: NextRequest, context: { params: Promise<{ route: string[] }> }) {
  const { route } = await context.params;
  const step = route?.[0];

  if (step === "login") {
    const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
    const redirectUri = new URL("/api/auth/callback", request.nextUrl.origin).toString();

    let authorizationUrl: URL;
    let flowCookieValue: string;
    try {
      ({ authorizationUrl, flowCookieValue } = await startSignIn(redirectUri, returnTo));
    } catch {
      return oidcUnavailableResponse();
    }

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OIDC_FLOW_COOKIE, flowCookieValue, flowCookieOptions());
    return response;
  }

  if (step === "callback") {
    const flowCookieValue = request.cookies.get(OIDC_FLOW_COOKIE)?.value;
    try {
      const { user, returnTo } = await completeSignIn(new URL(request.url), flowCookieValue);
      const token = await createAuthSession(user.id, user.clientId);
      const response = NextResponse.redirect(new URL(safeReturnPath(returnTo), request.nextUrl.origin));
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      response.cookies.delete(OIDC_FLOW_COOKIE);
      return response;
    } catch (error) {
      const denied = error instanceof Error && ["client-access-denied", "invalid-sign-in-flow"].includes(error.message);
      const response = NextResponse.json({ error: denied ? "Sign-in expired or access has not been provisioned. Contact your administrator." : "Sign-in could not be completed. Try again or contact your administrator." }, { status: denied ? 403 : 503 });
      response.cookies.delete(OIDC_FLOW_COOKIE);
      return response;
    }
  }

  if (step === "logout") {
    return NextResponse.json({ error: "Use POST to sign out." }, { status: 405, headers: { Allow: "POST" } });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ route: string[] }> }) {
  const { route } = await context.params;
  if (route.length !== 1 || route[0] !== "logout") return NextResponse.json({ error: "Not found" }, { status: 404 });
  await revokeAuthSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/** Do not expose provider responses, callback codes or credentials in logs or HTTP output. */
function oidcUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Sign-in is temporarily unavailable. Contact your administrator.",
    },
    { status: 503 },
  );
}
