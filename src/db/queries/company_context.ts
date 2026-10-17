import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { companyContextRevision, governanceAudit, sourceConnection, authSession, clientMembership } from "@/src/db/schema";
import { companyContextProblem, parseCompanyContextEdit, type CompanyContext, type CompanyContextContent } from "@/src/core/companyContext";
import { isAdminRole } from "@/src/lib/rolePolicy";
import { validTenantRole } from "@/src/lib/authTokens";
import { researchSnapshotDigest } from "@/src/abilities/snapshot";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type CompanyContextAuthority = { clientId: number; actorUserId: number; sessionHash: string };
export function companyContextDomain(row: typeof companyContextRevision.$inferSelect): CompanyContext {
  return { schemaVersion: 1, clientId: String(row.clientId), version: row.version, content: row.contentJson as CompanyContextContent,
    declaredBy: row.declaredBy, recordedAt: row.recordedAt.toISOString(), reviewAfter: row.reviewAfter.toISOString(), changeReason: row.changeReason };
}
export async function getCompanyContext(clientId: number, tx: Tx | typeof db = db): Promise<CompanyContext | null> {
  const [row] = await tx.select().from(companyContextRevision).where(eq(companyContextRevision.clientId, clientId)).orderBy(desc(companyContextRevision.version)).limit(1);
  return row ? companyContextDomain(row) : null;
}
/** Shared advisory lock also protects absence: a new first version cannot race a research save. */
export async function lockCompanyContext(tx: Tx, clientId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(73009, ${clientId})`);
  return getCompanyContext(clientId, tx);
}
export async function listCompanyContextHistory(clientId: number) {
  const rows = await db.select().from(companyContextRevision).where(eq(companyContextRevision.clientId, clientId)).orderBy(desc(companyContextRevision.version)).limit(50);
  return rows.map(companyContextDomain);
}
export async function saveCompanyContext(authority: CompanyContextAuthority, value: unknown) {
  const edit = parseCompanyContextEdit(value);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73009, ${authority.clientId})`);
    const [membership] = await tx.select().from(clientMembership).where(and(eq(clientMembership.clientId, authority.clientId), eq(clientMembership.userId, authority.actorUserId))).for("share");
    const [session] = await tx.select().from(authSession).where(and(eq(authSession.tokenHash, authority.sessionHash), eq(authSession.clientId, authority.clientId), eq(authSession.userId, authority.actorUserId))).for("share");
    const checkAuthority = async () => {
      const result = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
      const now = new Date(result.rows[0].now);
      if (!membership || !validTenantRole(membership.role) || !isAdminRole(membership.role) || !session || session.revokedAt || session.createdAt > now || session.expiresAt <= now) throw new Error("company-context-permission-denied");
      return now;
    };
    const now = await checkAuthority();
    if (Date.parse(edit.reviewAfter) <= now.getTime() || Date.parse(edit.reviewAfter) > now.getTime() + 366 * 86400000) throw new Error("company-context-review-date-invalid");
    const current = await getCompanyContext(authority.clientId, tx);
    if ((current?.version ?? null) !== edit.expectedVersion) throw new Error("company-context-version-conflict");
    const ids = [...new Set(edit.content.sourceBindings.map((item) => item.sourceConnectionId))];
    const sources = ids.length ? await tx.select().from(sourceConnection).where(and(eq(sourceConnection.clientId, authority.clientId), inArray(sourceConnection.id, ids))).for("share") : [];
    if (sources.length !== ids.length || edit.content.sourceBindings.some((binding) => {
      const source = sources.find((item) => item.id === binding.sourceConnectionId);
      return !source || (binding.purpose === "strategy" ? source.sourceClass !== "client_owned" : source.sourceClass !== "first_party_aggregate");
    })) throw new Error("company-context-source-invalid");
    const [row] = await tx.insert(companyContextRevision).values({ clientId: authority.clientId, version: (current?.version ?? 0) + 1, contentJson: edit.content, declaredBy: authority.actorUserId, recordedAt: now, reviewAfter: new Date(edit.reviewAfter), changeReason: edit.changeReason }).returning();
    await tx.insert(governanceAudit).values({ clientId: authority.clientId, actorUserId: authority.actorUserId, action: "declare_company_context", entityType: "company_context", entityId: String(row.id),
      redactedAfterJson: { version: row.version, previousVersion: current?.version ?? null, contentDigest: researchSnapshotDigest(edit.content), reviewAfter: edit.reviewAfter } });
    const completedAt = await checkAuthority();
    if (Date.parse(edit.reviewAfter) <= completedAt.getTime()) throw new Error("company-context-review-date-invalid");
    return companyContextDomain(row);
  });
}
export async function companyContextEnvelope(clientId: number) {
  const current = await getCompanyContext(clientId);
  const gap = current ? companyContextProblem(current, String(clientId), new Date().toISOString()) : "Company context has not been declared.";
  return { contract: "company-context@1" as const, status: gap ? "needs_context" as const : "available" as const, current, gaps: gap ? [gap] : [],
    use: "Owner-declared strategy, not independent market evidence. Read current on each task; do not treat historical versions as current." };
}
