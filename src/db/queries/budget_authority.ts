import { and, eq } from "drizzle-orm";
import { authSession, clientMembership } from "@/src/db/schema";
import type { db } from "@/src/db/client";
import { isAdminRole } from "@/src/lib/rolePolicy";
import { validTenantRole } from "@/src/lib/authTokens";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BudgetWriteAuthority = { clientId: number; actorUserId: number; sessionHash: string; expectedVersion: number | null };

/** Called under the budget lock. Membership → session matches session creation's lock order.
 * The authenticated route supplies these fields, never the request JSON. Named permission and
 * session expiry are rechecked after potentially blocked writes, so failed authority rolls back audit too.
 */
export async function lockBudgetAuthority(tx: Tx, clientId: number, authority?: BudgetWriteAuthority): Promise<(now: Date) => void> {
  if (!authority) return () => {}; // Existing trusted operator CLI, not a public bypass.
  if (authority.clientId !== clientId || !Number.isSafeInteger(authority.actorUserId) || authority.actorUserId < 1
    || !/^[a-f0-9]{64}$/.test(authority.sessionHash)
    || (authority.expectedVersion !== null && (!Number.isSafeInteger(authority.expectedVersion) || authority.expectedVersion < 1))) throw new Error("budget-permission-denied");
  const [membership] = await tx.select().from(clientMembership).where(and(eq(clientMembership.clientId, clientId), eq(clientMembership.userId, authority.actorUserId))).for("share");
  if (!membership || !validTenantRole(membership.role) || !isAdminRole(membership.role)) throw new Error("budget-permission-denied");
  const [session] = await tx.select().from(authSession).where(and(eq(authSession.tokenHash, authority.sessionHash), eq(authSession.clientId, clientId), eq(authSession.userId, authority.actorUserId))).for("share");
  return (now: Date) => {
    if (!session || session.revokedAt || session.createdAt > now || session.expiresAt <= now) throw new Error("budget-permission-denied");
  };
}

export function checkBudgetVersion(current: number | undefined, authority?: BudgetWriteAuthority) {
  if (authority && (current ?? null) !== authority.expectedVersion) throw new Error("budget-version-conflict");
}
