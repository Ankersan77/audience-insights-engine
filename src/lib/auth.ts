import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { discovery, randomPKCECodeVerifier, randomState, randomNonce, calculatePKCECodeChallenge, buildAuthorizationUrl, authorizationCodeGrant, type Configuration } from "openid-client";
import { resolveAuthSession, resolveProvisionedIdentity } from "@/src/db/queries/auth_sessions";
import { decodeFlowCookie, encodeFlowCookie, safeReturnPath, SESSION_MAX_AGE_SECONDS, FLOW_MAX_AGE_SECONDS, type SessionUser } from "./authTokens";
import type { TenantRole } from "@/src/core/tenancy";

export type Role = TenantRole;
export type { SessionUser } from "./authTokens";
export const SESSION_COOKIE = "market_research_session";
export const OIDC_FLOW_COOKIE = "market_research_oidc_flow";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let configPromise: Promise<Configuration> | null = null;
async function getOidcConfig(): Promise<Configuration> {
  if (!configPromise) {
    configPromise = discovery(new URL(requiredEnv("ONELOGIN_DISCOVERY_URL")), requiredEnv("ONELOGIN_CLIENT_ID"), requiredEnv("ONELOGIN_CLIENT_SECRET"))
      .catch((error) => { configPromise = null; throw error; });
  }
  return configPromise;
}

/** OIDC handles identity; Core's current tenant membership determines permission. */
export async function startSignIn(redirectUri: string, returnTo: string) {
  const config = await getOidcConfig();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const authorizationUrl = buildAuthorizationUrl(config, { redirect_uri: redirectUri, scope: "openid profile email", code_challenge: codeChallenge, code_challenge_method: "S256", state, nonce });
  return { authorizationUrl, flowCookieValue: encodeFlowCookie({ state, nonce, codeVerifier, returnTo: safeReturnPath(returnTo) }, requiredEnv("SESSION_SECRET")) };
}

export async function completeSignIn(currentUrl: URL, flowCookieValue: string | undefined): Promise<{ user: SessionUser; returnTo: string }> {
  const flow = decodeFlowCookie(flowCookieValue, requiredEnv("SESSION_SECRET"));
  if (!flow) throw new Error("invalid-sign-in-flow");
  const config = await getOidcConfig();
  const tokens = await authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier: flow.codeVerifier, expectedState: flow.state, expectedNonce: flow.nonce });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("identity-token-required");
  const email = typeof claims.email === "string" ? claims.email : "";
  const name = typeof claims.name === "string" ? claims.name : email;
  const user = await resolveProvisionedIdentity({ subject: claims.sub, clientSlug: process.env.MARKET_RESEARCH_CLIENT_SLUG?.trim() || "default-client", email, name });
  return { user, returnTo: safeReturnPath(flow.returnTo) };
}

export function sessionCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_MAX_AGE_SECONDS };
}

export function flowCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: FLOW_MAX_AGE_SECONDS };
}

/** Every request resolves server expiry/revocation and the current tenant role. No signed role snapshot is trusted. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveAuthSession(store.get(SESSION_COOKIE)?.value);
}

export async function requireSession(returnTo = "/projects"): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect(`/api/auth/login?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
  return session;
}
