import { and, eq, sql } from "drizzle-orm";
import type { TenantRole } from "@/src/core/tenancy";
import { db } from "@/src/db/client";
import { appUser, client, clientMembership, governanceAudit } from "@/src/db/schema";
import { validTenantRole } from "@/src/lib/authTokens";

/** Operator-only provisioning primitive. No public endpoint or OIDC claim can grant membership. */
export async function setClientAccess(input: { action: "grant" | "revoke"; clientSlug: string; subject: string; role?: TenantRole; createClientName?: string }): Promise<{ clientId: number; userId: number | null; changed: boolean }> {
  if (!input.clientSlug.trim() || !input.subject.trim() || (input.action === "grant" && !validTenantRole(input.role))) throw new Error("invalid-access-request");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73006, hashtext(${input.subject}))`);
    if (input.action === "grant" && input.createClientName?.trim()) await tx.insert(client).values({ slug: input.clientSlug, name: input.createClientName.trim() }).onConflictDoNothing({ target: client.slug });
    const [tenant] = await tx.select().from(client).where(eq(client.slug, input.clientSlug)).limit(1);
    if (!tenant) throw new Error("client-not-found");
    const matches = await tx.select().from(appUser).where(eq(appUser.ssoSubjectId, input.subject)).limit(2);
    if (matches.length > 1) throw new Error("ambiguous-identity-requires-operator-review");
    let user = matches[0];
    if (!user && input.action === "revoke") return { clientId: tenant.id, userId: null, changed: false };
    if (!user) [user] = await tx.insert(appUser).values({ ssoSubjectId: input.subject, name: "Provisioned user", email: "", role: "viewer" }).returning();
    const [before] = await tx.select().from(clientMembership).where(and(eq(clientMembership.clientId, tenant.id), eq(clientMembership.userId, user.id))).limit(1);
    if (input.action === "revoke") await tx.delete(clientMembership).where(and(eq(clientMembership.clientId, tenant.id), eq(clientMembership.userId, user.id)));
    else await tx.insert(clientMembership).values({ clientId: tenant.id, userId: user.id, role: input.role! }).onConflictDoUpdate({ target: [clientMembership.clientId, clientMembership.userId], set: { role: input.role! } });
    const changed = input.action === "revoke" ? Boolean(before) : before?.role !== input.role;
    if (changed) await tx.insert(governanceAudit).values({ clientId: tenant.id, action: input.action === "revoke" ? "operator_revoke_access" : "operator_grant_access", entityType: "client_membership", entityId: String(user.id), redactedBeforeJson: before ? { role: before.role } : null, redactedAfterJson: input.action === "grant" ? { role: input.role } : { revoked: true } });
    return { clientId: tenant.id, userId: user.id, changed };
  });
}
