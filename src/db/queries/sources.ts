import { and, asc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { sourceConnection } from "@/src/db/schema";
import type { RightsDeclaration, SourceClass } from "@/src/core/contracts";

export type SourceConnectionListRow = {
  id: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  health: "configured" | "verified" | "degraded" | "unavailable" | "producing_evidence";
  hasCredentialReference: boolean;
  rights: RightsDeclaration;
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
      retentionDays: sourceConnection.retentionDays,
      rawRetentionHours: sourceConnection.rawRetentionHours,
      lastSuccessfulReceiptAt: sourceConnection.lastSuccessfulReceiptAt,
    })
    .from(sourceConnection)
    .where(eq(sourceConnection.clientId, clientId))
    .orderBy(asc(sourceConnection.connectorId));

  return rows.map((row) => ({
    ...row,
    sourceClass: row.sourceClass as SourceClass,
    hasCredentialReference: Boolean(row.credentialRef),
    rights: row.rights as RightsDeclaration,
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
      configurationJson: {},
      rightsJson: input.rights,
      retentionDays: input.retentionDays,
      rawRetentionHours: input.rawRetentionHours,
      health: "configured",
    })
    .returning();
  return created;
}

