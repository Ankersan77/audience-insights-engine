import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { appUser, authSession, client, clientMembership } from "@/src/db/schema";
import { newSessionToken, sessionTokenHash, SESSION_MAX_AGE_SECONDS, validTenantRole, type SessionUser } from "@/src/lib/authTokens";

export async function createAuthSession(userId: number, clientId: number, now?: Date): Promise<string> {
  if (now && !Number.isFinite(now.getTime())) throw new Error("invalid-session-time");
  return db.transaction(async (tx) => {
    const [membership] = await tx.select().from(clientMembership).where(and(eq(clientMembership.userId, userId), eq(clientMembership.clientId, clientId))).limit(1).for("share");
    if (!membership || !validTenantRole(membership.role)) throw new Error("client-access-denied");
    // Production session validity and locked budget authority share the database clock.
    // An explicit instant remains available for deterministic expiry tests.
    const instant = now ?? new Date((await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`)).rows[0].now);
    const token = newSessionToken();
    await tx.insert(authSession).values({ tokenHash: sessionTokenHash(token)!, userId, clientId, createdAt: instant, expiresAt: new Date(instant.getTime() + SESSION_MAX_AGE_SECONDS * 1000) });
    return token;
  });
}

export async function resolveAuthSession(token: string | undefined, now?: Date): Promise<SessionUser | null> {
  const hash = sessionTokenHash(token);
  if (!hash || (now && !Number.isFinite(now.getTime()))) return null;
  const instant = now ?? sql`clock_timestamp()`;
  const [row] = await db.select({ user: appUser, tenant: client, role: clientMembership.role }).from(authSession)
    .innerJoin(clientMembership, and(eq(clientMembership.clientId, authSession.clientId), eq(clientMembership.userId, authSession.userId)))
    .innerJoin(appUser, eq(appUser.id, authSession.userId))
    .innerJoin(client, eq(client.id, authSession.clientId))
    .where(and(eq(authSession.tokenHash, hash), isNull(authSession.revokedAt), lte(authSession.createdAt, instant), gt(authSession.expiresAt, instant))).limit(1);
  if (!row || !validTenantRole(row.role)) return null;
  return { id: row.user.id, clientId: row.tenant.id, clientSlug: row.tenant.slug, role: row.role, email: row.user.email, name: row.user.name, ssoSubjectId: row.user.ssoSubjectId };
}

export async function revokeAuthSession(token: string | undefined, now = new Date()): Promise<void> {
  const hash = sessionTokenHash(token);
  if (!hash) return;
  await db.update(authSession).set({ revokedAt: now }).where(and(eq(authSession.tokenHash, hash), isNull(authSession.revokedAt)));
}

/** Authentication records contain no research evidence; expired/revoked tokens need not accumulate. */
export async function purgeAuthSessions(now = new Date()): Promise<number> {
  const rows = await db.delete(authSession).where(or(lte(authSession.expiresAt, now), lte(authSession.revokedAt, now))).returning({ id: authSession.tokenHash });
  return rows.length;
}

/** A verified OIDC identity may use only an explicitly provisioned tenant membership. */
export async function resolveProvisionedIdentity(input: { subject: string; clientSlug: string; email: string; name: string }): Promise<SessionUser> {
  return db.transaction(async (tx) => {
    const matches = await tx.select({ user: appUser, tenant: client, role: clientMembership.role }).from(appUser)
      .innerJoin(clientMembership, eq(clientMembership.userId, appUser.id))
      .innerJoin(client, eq(client.id, clientMembership.clientId))
      .where(and(eq(appUser.ssoSubjectId, input.subject), eq(client.slug, input.clientSlug))).limit(2);
    if (matches.length !== 1 || !validTenantRole(matches[0].role)) throw new Error("client-access-denied");
    const row = matches[0];
    await tx.update(appUser).set({ email: input.email, name: input.name, lastLoginAt: new Date() }).where(eq(appUser.id, row.user.id));
    return { id: row.user.id, clientId: row.tenant.id, clientSlug: row.tenant.slug, role: row.role as SessionUser["role"], email: input.email, name: input.name, ssoSubjectId: input.subject };
  });
}
