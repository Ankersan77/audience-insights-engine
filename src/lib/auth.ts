import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  discovery,
  randomPKCECodeVerifier,
  randomState,
  randomNonce,
  calculatePKCECodeChallenge,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  type Configuration,
} from "openid-client";
import { db } from "@/src/db/client";
import { appUser, client, clientMembership } from "@/src/db/schema";
import type { TenantRole } from "@/src/core/tenancy";

/**
 * OneLogin OIDC sign-in (Rule 7: company SSO for an internal tool, no local
 * password store). Authorization Code + PKCE against the discovery document
 * named by `ONELOGIN_DISCOVERY_URL`. The session itself is a signed, HttpOnly
 * cookie — there is no server-side session table in the schema (spec §11), so
 * the cookie carries the already-resolved `app_user` row.
 */

export type Role = TenantRole;

export type SessionUser = {
  id: number;
  clientId: number;
  clientSlug: string;
  email: string;
  name: string;
  role: Role;
  ssoSubjectId: string;
};

export const SESSION_COOKIE = "market_research_session";
export const OIDC_FLOW_COOKIE = "market_research_oidc_flow";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours
const FLOW_MAX_AGE_SECONDS = 60 * 10; // 10 minutes — just long enough for a sign-in

type FlowState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sessionSecret(): string {
  return requiredEnv("SESSION_SECRET");
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

/** Encodes and HMAC-signs an arbitrary JSON-serialisable payload for a cookie value. */
function encodeSigned(data: unknown): string {
  const payload = base64url(JSON.stringify(data));
  return `${payload}.${sign(payload)}`;
}

/** Verifies and decodes a cookie value produced by {@link encodeSigned}. Returns `null` on any mismatch. */
function decodeSigned<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

let configPromise: Promise<Configuration> | null = null;

/** Lazily discovers the OneLogin OIDC configuration once per process. */
async function getOidcConfig(): Promise<Configuration> {
  if (!configPromise) {
    configPromise = discovery(
      new URL(requiredEnv("ONELOGIN_DISCOVERY_URL")),
      requiredEnv("ONELOGIN_CLIENT_ID"),
      requiredEnv("ONELOGIN_CLIENT_SECRET"),
    ).catch((error) => {
      // Don't cache a failed discovery — a transiently-unreachable IdP or a
      // not-yet-provisioned credential shouldn't permanently wedge the app.
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
}

/** Only Secure in production, so local development over plain http still works. */
function cookieIsSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Builds the OneLogin authorization URL for a fresh sign-in and the matching
 * short-lived flow cookie (state/nonce/PKCE verifier/return path) the
 * callback step verifies against.
 */
export async function startSignIn(redirectUri: string, returnTo: string) {
  const config = await getOidcConfig();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();

  const authorizationUrl = buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  const flow: FlowState = { state, nonce, codeVerifier, returnTo };
  return { authorizationUrl, flowCookieValue: encodeSigned(flow) };
}

/** Maps the OIDC groups/role claim to this app's two-role model (Rule 7). Unrecognised users default to viewer. */
function mapRole(claims: Record<string, unknown>): Role {
  const raw = claims.groups ?? claims.role ?? claims.roles;
  const values = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [])
    .map((value) => String(value).toLowerCase());
  const mappings: readonly [Role, string][] = [
    ["owner", process.env.ONELOGIN_OWNER_GROUP ?? "owner"],
    ["admin", process.env.ONELOGIN_ADMIN_GROUP ?? "admin"],
    ["researcher", process.env.ONELOGIN_RESEARCHER_GROUP ?? "researcher"],
    ["reviewer", process.env.ONELOGIN_REVIEWER_GROUP ?? "reviewer"],
  ];
  return mappings.find(([, group]) => values.includes(group.toLowerCase()))?.[0] ?? "viewer";
}

/** Inserts or updates `app_user` on `sso_subject_id`, per T10's acceptance criterion. */
async function upsertAppUser(input: {
  ssoSubjectId: string;
  email: string;
  name: string;
  role: Role;
}): Promise<typeof appUser.$inferSelect> {
  const existing = await db.query.appUser.findFirst({
    where: eq(appUser.ssoSubjectId, input.ssoSubjectId),
  });

  if (existing) {
    const [updated] = await db
      .update(appUser)
      .set({ email: input.email, name: input.name, role: input.role, lastLoginAt: new Date() })
      .where(eq(appUser.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(appUser)
    .values({
      ssoSubjectId: input.ssoSubjectId,
      email: input.email,
      name: input.name,
      role: input.role,
      lastLoginAt: new Date(),
    })
    .returning();
  return created;
}

async function resolveClientMembership(
  userId: number,
  role: Role,
): Promise<{ clientId: number; clientSlug: string; role: Role }> {
  const configuredSlug = process.env.MARKET_RESEARCH_CLIENT_SLUG?.trim() || "default-client";
  const configuredName = process.env.MARKET_RESEARCH_CLIENT_NAME?.trim() || "Default Client";

  await db
    .insert(client)
    .values({ slug: configuredSlug, name: configuredName })
    .onConflictDoNothing({ target: client.slug });

  const [clientRow] = await db.select().from(client).where(eq(client.slug, configuredSlug)).limit(1);
  if (!clientRow) throw new Error("Configured client could not be resolved.");

  await db
    .insert(clientMembership)
    .values({ clientId: clientRow.id, userId, role })
    .onConflictDoUpdate({
      target: [clientMembership.clientId, clientMembership.userId],
      set: { role },
    });

  const [membership] = await db
    .select({ clientId: clientMembership.clientId })
    .from(clientMembership)
    .where(and(eq(clientMembership.clientId, clientRow.id), eq(clientMembership.userId, userId)))
    .limit(1);
  if (!membership) throw new Error("Client membership could not be resolved.");

  return { clientId: clientRow.id, clientSlug: clientRow.slug, role };
}

function toSessionUser(
  row: typeof appUser.$inferSelect,
  membership: { clientId: number; clientSlug: string; role: Role },
): SessionUser {
  return {
    id: row.id,
    clientId: membership.clientId,
    clientSlug: membership.clientSlug,
    email: row.email,
    name: row.name,
    role: membership.role,
    ssoSubjectId: row.ssoSubjectId,
  };
}

/**
 * Completes the Authorization Code + PKCE exchange for the given callback
 * request, maps the role, and upserts `app_user`. Returns the session user
 * and the `returnTo` path from the flow cookie.
 */
export async function completeSignIn(
  currentUrl: URL,
  flowCookieValue: string | undefined,
): Promise<{ user: SessionUser; returnTo: string }> {
  const flow = decodeSigned<FlowState>(flowCookieValue);
  if (!flow) {
    throw new Error("Sign-in session expired or is invalid. Please try again.");
  }

  const config = await getOidcConfig();
  const tokens = await authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
  });

  const claims = tokens.claims();
  if (!claims?.sub) {
    throw new Error("OneLogin did not return an identity token.");
  }

  const email = typeof claims.email === "string" ? claims.email : `${claims.sub}@unknown`;
  const name = typeof claims.name === "string" ? claims.name : email;

  const userRow = await upsertAppUser({
    ssoSubjectId: claims.sub,
    email,
    name,
    role: mapRole(claims as Record<string, unknown>),
  });
  const membership = await resolveClientMembership(userRow.id, mapRole(claims as Record<string, unknown>));
  const user = toSessionUser(userRow, membership);

  return { user, returnTo: flow.returnTo || "/brands" };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieIsSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function flowCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieIsSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: FLOW_MAX_AGE_SECONDS,
  };
}

export function encodeSessionCookie(user: SessionUser): string {
  return encodeSigned(user);
}

/** Reads and verifies the session cookie for the current request. `null` when signed out or the cookie is invalid/tampered. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const session = decodeSigned<SessionUser>(store.get(SESSION_COOKIE)?.value);
  if (!session || !Number.isInteger(session.clientId) || !session.clientSlug || !["owner", "admin", "researcher", "reviewer", "viewer"].includes(session.role)) return null;
  return session;
}

/**
 * For use at the top of a server-rendered page: redirects an unauthenticated
 * request to OneLogin (via `/api/auth/login`) rather than rendering. This is
 * T10's acceptance criterion ("an unauthenticated request to /brands
 * redirects to OneLogin").
 */
export async function requireSession(returnTo = "/brands"): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return session;
}
