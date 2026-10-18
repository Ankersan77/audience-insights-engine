import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { canonicalEvidence, sourceConnection } from "../schema";
import { currentEvidenceUseFailure } from "../../evidence/usePolicy";
import { canonicalEvidenceItem } from "./canonical_evidence";

export type EvidenceUseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Source-first locks serialize current-evidence writes against O(1) revocation. */
export async function assertCurrentEvidenceUse(
  tx: EvidenceUseTransaction,
  input: { clientId: number; evidenceIds: readonly number[]; now: Date },
): Promise<void> {
  if (!Number.isFinite(input.now.getTime())) throw new Error("invalid-evidence-use-time");
  const ids = [...new Set(input.evidenceIds)];
  if (ids.length === 0) return;
  if (ids.length > 100) throw new Error("evidence-reference-limit-exceeded");

  const located = await tx.select({ id: canonicalEvidence.id, sourceConnectionId: canonicalEvidence.sourceConnectionId })
    .from(canonicalEvidence)
    .where(and(eq(canonicalEvidence.clientId, input.clientId), inArray(canonicalEvidence.id, ids)));
  if (located.length !== ids.length) throw new Error("evidence-scope-mismatch");

  const sourceIds = [...new Set(located.map((item) => item.sourceConnectionId))];
  const sources = await tx.select().from(sourceConnection)
    .where(and(eq(sourceConnection.clientId, input.clientId), inArray(sourceConnection.id, sourceIds)))
    .orderBy(asc(sourceConnection.id))
    .for("share");
  if (sources.length !== sourceIds.length) throw new Error("evidence-source-unavailable");

  const evidence = await tx.select().from(canonicalEvidence)
    .where(and(eq(canonicalEvidence.clientId, input.clientId), inArray(canonicalEvidence.id, ids)))
    .orderBy(asc(canonicalEvidence.id))
    .for("share");
  if (evidence.length !== ids.length) throw new Error("evidence-scope-mismatch");

  // An explicitly simulated future instant remains useful to deterministic
  // maintenance tests, but a caller-captured past instant can never authorize
  // evidence after a lock wait crosses its expiry.
  const databaseNow = new Date((await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`)).rows[0].now);
  const effectiveNow = input.now > databaseNow ? input.now : databaseNow;

  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  for (const row of evidence) {
    const source = sourceMap.get(row.sourceConnectionId);
    if (!source) throw new Error("evidence-source-unavailable");
    const item = canonicalEvidenceItem({ evidence: row, sourceClass: source.sourceClass });
    const failure = currentEvidenceUseFailure({ clientId: input.clientId, evidence: item, source, now: effectiveNow });
    if (failure) throw new Error(`evidence-use-denied:${failure}`);
  }
}
