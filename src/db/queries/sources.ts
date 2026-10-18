import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/src/db/client";
import { governanceAudit, sourceConnection } from "@/src/db/schema";
import type { RightsDeclaration, SourceClass, SourceConnectionPolicy } from "@/src/core/contracts";
import { readSourceConnectionPolicy } from "@/src/connectors/sourcePolicy";
import { redactIdentifiers } from "@/src/evidence/textSafety";

export type SourceConnectionListRow = {
  id: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  health: "configured" | "verified" | "degraded" | "unavailable" | "producing_evidence";
  hasCredentialReference: boolean;
  rights: RightsDeclaration;
  policy: SourceConnectionPolicy;
  retentionDays: number;
  rawRetentionHours: number;
  lastSuccessfulReceiptAt: Date | null;
};

export async function listSourceConnections(clientId: number): Promise<SourceConnectionListRow[]> {
  const rows = await db
    .select({
      id: sourceConnection.id,
      connectorId: sourceConnection.connectorId,
      connectorVersion: sourceConnection.connectorVersion,
      sourceClass: sourceConnection.sourceClass,
      health: sourceConnection.health,
      credentialRef: sourceConnection.credentialRef,
      rights: sourceConnection.rightsJson,
      configuration: sourceConnection.configurationJson,
      retentionDays: sourceConnection.retentionDays,
      rawRetentionHours: sourceConnection.rawRetentionHours,
      lastSuccessfulReceiptAt: sourceConnection.lastSuccessfulReceiptAt,
    })
    .from(sourceConnection)
    .where(eq(sourceConnection.clientId, clientId))
    .orderBy(asc(sourceConnection.connectorId));

  return rows.map(({ credentialRef, configuration, ...row }) => ({
    ...row,
    sourceClass: row.sourceClass as SourceClass,
    hasCredentialReference: Boolean(credentialRef),
    rights: row.rights as RightsDeclaration,
    policy: readSourceConnectionPolicy(configuration),
  }));
}

export async function getSourceConnection(clientId: number, id: number) {
  const [row] = await db
    .select()
    .from(sourceConnection)
    .where(and(eq(sourceConnection.clientId, clientId), eq(sourceConnection.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createSourceConnection(input: {
  clientId: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  credentialRef?: string;
  rights: RightsDeclaration;
  policy: SourceConnectionPolicy;
  retentionDays: number;
  rawRetentionHours: number;
}) {
  const [created] = await db
    .insert(sourceConnection)
    .values({
      clientId: input.clientId,
      connectorId: input.connectorId,
      connectorVersion: input.connectorVersion,
      sourceClass: input.sourceClass,
      credentialRef: input.credentialRef || null,
      configurationJson: input.policy,
      rightsJson: input.rights,
      retentionDays: input.retentionDays,
      rawRetentionHours: input.rawRetentionHours,
      health: "configured",
    })
    .returning();
  return created;
}

/**
 * Revokes authority in one source-row transition. Dependent cleanup is deliberately
 * asynchronous and bounded by canonical maintenance; every use/persistence path
 * must treat this timestamp (and unavailable health) as immediately fail-closed.
 */
export async function revokeSourceConnection(input: {
  clientId: number;
  id: number;
  now: Date;
  audit?: { actorUserId?: number; reason?: string };
}) {
  if (!Number.isFinite(input.now.getTime())) throw new Error("invalid-source-revocation-time");
  const reason = input.audit?.reason
    ? redactIdentifiers(input.audit.reason.slice(0, 500)).content
    : "programmatic-source-revocation";
  return db.transaction(async (tx) => {
    const [revoked] = await tx.update(sourceConnection).set({
      health: "unavailable",
      revokedAt: input.now,
    }).where(and(
      eq(sourceConnection.id, input.id),
      eq(sourceConnection.clientId, input.clientId),
      isNull(sourceConnection.revokedAt),
    )).returning({ id: sourceConnection.id, revokedAt: sourceConnection.revokedAt });
    if (revoked) {
      await tx.insert(governanceAudit).values({
        clientId: input.clientId,
        actorUserId: input.audit?.actorUserId,
        action: "revoke",
        entityType: "source_connection",
        entityId: String(input.id),
        redactedAfterJson: {
          status: "unavailable",
          revokedAt: revoked.revokedAt!.toISOString(),
          cleanupPending: true,
          reason,
        },
        createdAt: input.now,
      });
      return { revokedAt: revoked.revokedAt!, cleanupPending: true as const };
    }
    const [existing] = await tx.select({ revokedAt: sourceConnection.revokedAt }).from(sourceConnection).where(and(
      eq(sourceConnection.id, input.id), eq(sourceConnection.clientId, input.clientId),
    )).limit(1);
    if (!existing) return null;
    return { revokedAt: existing.revokedAt!, cleanupPending: true as const };
  });
}

