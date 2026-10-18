import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  canonicalEvidence,
  canonicalRetentionWork,
  citation,
  governanceAudit,
  qualitativeTheme,
  quantitativeObservation,
  researchArtifact,
} from "@/src/db/schema";
import { CANONICAL_RETENTION_LIMITS, redactExpiredCitationCopies, tombstoneEvidence } from "@/src/operations/retention";

export { CANONICAL_RETENTION_LIMITS } from "@/src/operations/retention";

export type BatchProgress = { processed: number; batchFull: boolean };

export type CanonicalRetentionSummary = {
  evidenceExpired: number;
  collectionsExpired: number;
  observationsRemoved: number;
  themesRemoved: number;
  artifactCitationsRedacted: number;
  intelligenceDecayed: number;
  batchFull?: boolean;
  deadlineReached?: boolean;
  progress?: {
    evidenceDiscovery: BatchProgress;
    retentionWork: BatchProgress;
    collections: BatchProgress;
    intelligence: BatchProgress;
  };
};

export type CanonicalRetentionOptions = { deadline?: Date | number };
type WorkPhase = "observations" | "themes" | "citations" | "artifacts" | "finalize";
type RetentionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ChunkResult = {
  claimed: boolean;
  batchFull: boolean;
  evidenceExpired: number;
  observationsRemoved: number;
  themesRemoved: number;
  artifactCitationsRedacted: number;
};

const emptyChunk = (): ChunkResult => ({
  claimed: false,
  batchFull: false,
  evidenceExpired: 0,
  observationsRemoved: 0,
  themesRemoved: 0,
  artifactCitationsRedacted: 0,
});

function isDatabaseDeferral(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && (current.code === "57014" || current.code === "55P03")) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function maintenanceOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isDatabaseDeferral(error)) throw new Error("maintenance-stage-deadline-exceeded", { cause: error });
    throw error;
  }
}

async function applyTransactionLimits(tx: RetentionTransaction, deadline?: Date | number) {
  const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline;
  const remainingMs = deadlineMs === undefined ? 10_000 : deadlineMs - Date.now();
  if (remainingMs <= 0) throw new Error("maintenance-stage-deadline-exceeded");
  const statementTimeoutMs = Math.max(1, Math.min(10_000, Math.trunc(remainingMs)));
  await tx.execute(sql`select set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)`);
  await tx.execute(sql`set local lock_timeout = '1s'`);
}

async function discoverRetentionWork(now: Date, clientId?: number, deadline?: Date | number): Promise<BatchProgress> {
  return db.transaction(async (tx) => {
    await applyTransactionLimits(tx, deadline);
    const tenant = clientId === undefined ? sql`true` : sql`e.client_id = ${clientId}`;
    const pendingTenant = clientId === undefined ? sql`true` : sql`pending_e.client_id = ${clientId}`;
    const discovered = await tx.execute<{ inserted: number; batch_full: boolean }>(sql`
      with due as materialized (
        select e.id
        from canonical_evidence e
        inner join source_connection s
          on s.id = e.source_connection_id and s.client_id = e.client_id
        where ${tenant}
          and e.lifecycle in ('candidate', 'live', 'quarantined')
          and (e.expires_at <= ${now} or s.revoked_at is not null)
          and not exists (
            select 1 from canonical_retention_work existing where existing.evidence_id = e.id
          )
        order by e.expires_at, e.id
        for update of e skip locked
        limit ${CANONICAL_RETENTION_LIMITS.discovery + 1}
      ), inserted as (
        insert into canonical_retention_work (evidence_id, phase, cursor_id, started_at, updated_at)
        select id, 'observations', 0, clock_timestamp(), clock_timestamp()
        from due limit ${CANONICAL_RETENTION_LIMITS.discovery}
        on conflict (evidence_id) do nothing
        returning evidence_id
      )
      select
        (select count(*)::int from inserted) as inserted,
        ((select count(*) > ${CANONICAL_RETENTION_LIMITS.discovery} from due) or exists (
          select 1
          from canonical_evidence pending_e
          inner join source_connection pending_s
            on pending_s.id = pending_e.source_connection_id and pending_s.client_id = pending_e.client_id
          where ${pendingTenant}
            and pending_e.lifecycle in ('candidate', 'live', 'quarantined')
            and (pending_e.expires_at <= ${now} or pending_s.revoked_at is not null)
            and not exists (
              select 1 from canonical_retention_work existing where existing.evidence_id = pending_e.id
            )
            and pending_e.id not in (
              select id from due limit ${CANONICAL_RETENTION_LIMITS.discovery}
            )
        )) as batch_full
    `);
    const row = discovered.rows[0];
    return { processed: row?.inserted ?? 0, batchFull: row?.batch_full ?? false };
  });
}

async function advanceWork(tx: RetentionTransaction, evidenceId: number, phase: WorkPhase, cursorId: number) {
  await tx.update(canonicalRetentionWork).set({ phase, cursorId, updatedAt: sql`clock_timestamp()` })
    .where(eq(canonicalRetentionWork.evidenceId, evidenceId));
}

async function processRetentionChunk(now: Date, clientId?: number, deadline?: Date | number): Promise<ChunkResult> {
  return db.transaction(async (tx) => {
    await applyTransactionLimits(tx, deadline);
    const tenant = clientId === undefined ? sql`true` : sql`e.client_id = ${clientId}`;
    const claim = await tx.execute<{
      evidence_id: number;
      phase: WorkPhase;
      cursor_id: number;
      client_id: number;
    }>(sql`
      select w.evidence_id, w.phase, w.cursor_id, e.client_id
      from canonical_retention_work w
      inner join canonical_evidence e on e.id = w.evidence_id
      where ${tenant}
      order by w.updated_at, w.evidence_id
      for update of w skip locked
      limit 1
    `);
    const work = claim.rows[0];
    if (!work) return emptyChunk();

    const result = { ...emptyChunk(), claimed: true };
    const rowLimit = CANONICAL_RETENTION_LIMITS.dependentRows;

    if (work.phase === "observations") {
      const rows = await tx.select({ id: quantitativeObservation.id }).from(quantitativeObservation)
        .where(and(
          eq(quantitativeObservation.evidenceId, work.evidence_id),
          eq(quantitativeObservation.clientId, work.client_id),
        ))
        .orderBy(quantitativeObservation.id).limit(rowLimit + 1).for("update");
      const ids = rows.slice(0, rowLimit).map(({ id }) => id);
      if (ids.length) await tx.delete(quantitativeObservation).where(and(
        inArray(quantitativeObservation.id, ids),
        eq(quantitativeObservation.clientId, work.client_id),
      ));
      result.observationsRemoved = ids.length;
      result.batchFull = rows.length > rowLimit;
      await advanceWork(tx, work.evidence_id, result.batchFull ? "observations" : "themes", 0);
      return result;
    }

    if (work.phase === "themes") {
      const selected = await tx.execute<{ id: number }>(sql`
        select id from qualitative_theme
        where client_id = ${work.client_id}
          and evidence_ids @> array[${work.evidence_id}]::integer[]
        order by id for update limit ${rowLimit + 1}
      `);
      const ids = selected.rows.slice(0, rowLimit).map(({ id }) => id);
      if (ids.length) await tx.delete(qualitativeTheme).where(and(
        inArray(qualitativeTheme.id, ids),
        eq(qualitativeTheme.clientId, work.client_id),
      ));
      result.themesRemoved = ids.length;
      result.batchFull = selected.rows.length > rowLimit;
      await advanceWork(tx, work.evidence_id, result.batchFull ? "themes" : "citations", 0);
      return result;
    }

    if (work.phase === "citations") {
      const selected = await tx.select({ id: citation.id }).from(citation).where(and(
        eq(citation.evidenceId, work.evidence_id),
        eq(citation.clientId, work.client_id),
        sql`(${citation.safeReference} <> '[expired evidence]' or ${citation.excerpt} is not null or ${citation.reviewReason} is distinct from 'Referenced evidence expired under its retention policy.')`,
      )).orderBy(citation.id).limit(rowLimit + 1).for("update");
      const ids = selected.slice(0, rowLimit).map(({ id }) => id);
      if (ids.length) {
        await tx.update(citation).set({
          safeReference: "[expired evidence]",
          excerpt: null,
          reviewReason: "Referenced evidence expired under its retention policy.",
          expiresAt: now,
        }).where(and(inArray(citation.id, ids), eq(citation.clientId, work.client_id)));
      }
      result.batchFull = selected.length > rowLimit;
      await advanceWork(tx, work.evidence_id, result.batchFull ? "citations" : "artifacts", 0);
      return result;
    }

    if (work.phase === "artifacts") {
      const artifactLimit = CANONICAL_RETENTION_LIMITS.artifacts;
      const selected = await tx.execute<{
        id: number;
        payload_bytes: number;
        evidence_reference_count: number;
      }>(sql`
        select id, octet_length(payload_json::text)::int as payload_bytes,
          cardinality(evidence_ids)::int as evidence_reference_count
        from research_artifact
        where client_id = ${work.client_id}
          and id > ${work.cursor_id}
          and evidence_ids @> array[${work.evidence_id}]::integer[]
        order by id for update limit ${artifactLimit + 1}
      `);
      const artifacts = selected.rows.slice(0, artifactLimit);
      for (const artifact of artifacts) {
        if (artifact.payload_bytes > CANONICAL_RETENTION_LIMITS.artifactJsonBytes
          || artifact.evidence_reference_count > CANONICAL_RETENTION_LIMITS.artifactEvidenceReferences) {
          // Legacy rows may predate the write-time bounds. Replace only the copied
          // payload with a small explicit quarantine envelope; retain the artifact
          // row and lineage columns so cleanup cannot starve on the same row forever.
          await tx.update(researchArtifact).set({
            status: "needs_context",
            payloadJson: {
              kind: "retention-redacted-artifact@1",
              reason: "Supporting evidence is no longer usable under current source policy.",
              evidenceId: String(work.evidence_id),
            },
          }).where(and(eq(researchArtifact.id, artifact.id), eq(researchArtifact.clientId, work.client_id)));
          result.artifactCitationsRedacted += 1;
          continue;
        }
        const [bounded] = await tx.select({ payloadJson: researchArtifact.payloadJson }).from(researchArtifact)
          .where(and(eq(researchArtifact.id, artifact.id), eq(researchArtifact.clientId, work.client_id))).limit(1);
        if (!bounded) continue;
        const redacted = redactExpiredCitationCopies(bounded.payloadJson, new Set([String(work.evidence_id)]));
        if (JSON.stringify(redacted) !== JSON.stringify(bounded.payloadJson)) {
          await tx.update(researchArtifact).set({ payloadJson: redacted }).where(and(
            eq(researchArtifact.id, artifact.id),
            eq(researchArtifact.clientId, work.client_id),
          ));
          result.artifactCitationsRedacted += 1;
        }
      }
      const cursorId = artifacts.at(-1)?.id ?? work.cursor_id;
      result.batchFull = selected.rows.length > artifactLimit;
      await advanceWork(tx, work.evidence_id, result.batchFull ? "artifacts" : "finalize", cursorId);
      return result;
    }

    const [evidence] = await tx.select().from(canonicalEvidence)
      .where(eq(canonicalEvidence.id, work.evidence_id)).limit(1).for("update");
    if (!evidence) {
      await tx.delete(canonicalRetentionWork).where(eq(canonicalRetentionWork.evidenceId, work.evidence_id));
      return result;
    }
    const remaining = await tx.execute<{
      observations: boolean;
      themes: boolean;
      citations: boolean;
      artifacts: boolean;
    }>(sql`
      select
        exists(select 1 from quantitative_observation where client_id = ${work.client_id} and evidence_id = ${work.evidence_id}) as observations,
        exists(select 1 from qualitative_theme where client_id = ${work.client_id} and evidence_ids @> array[${work.evidence_id}]::integer[]) as themes,
        exists(select 1 from citation where client_id = ${work.client_id} and evidence_id = ${work.evidence_id}
          and (safe_reference <> '[expired evidence]' or excerpt is not null
            or review_reason is distinct from 'Referenced evidence expired under its retention policy.')) as citations,
        exists(select 1 from research_artifact where client_id = ${work.client_id} and id > ${work.cursor_id}
          and evidence_ids @> array[${work.evidence_id}]::integer[]) as artifacts
    `);
    const pending = remaining.rows[0];
    if (pending.observations || pending.themes || pending.citations || pending.artifacts) {
      const phase: WorkPhase = pending.observations ? "observations"
        : pending.themes ? "themes" : pending.citations ? "citations" : "artifacts";
      await advanceWork(tx, work.evidence_id, phase, phase === "artifacts" ? work.cursor_id : 0);
      result.batchFull = true;
      return result;
    }

    if (evidence.lifecycle !== "expired") {
      await tx.update(canonicalEvidence).set(tombstoneEvidence(evidence))
        .where(and(eq(canonicalEvidence.id, evidence.id), eq(canonicalEvidence.clientId, evidence.clientId)));
      result.evidenceExpired = 1;
      await tx.insert(governanceAudit).values({
        clientId: evidence.clientId,
        action: "retention_enforced",
        entityType: "canonical_evidence",
        entityId: String(evidence.id),
        redactedAfterJson: { evidenceExpired: 1 },
        createdAt: now,
      });
    }
    await tx.delete(canonicalRetentionWork).where(eq(canonicalRetentionWork.evidenceId, work.evidence_id));
    return result;
  });
}

async function expireCollections(now: Date, clientId?: number, deadline?: Date | number): Promise<BatchProgress> {
  return db.transaction(async (tx) => {
    await applyTransactionLimits(tx, deadline);
    const tenant = clientId === undefined ? sql`true` : sql`c.client_id = ${clientId}`;
    const limit = CANONICAL_RETENTION_LIMITS.collections;
    const updated = await tx.execute<{ client_id: number; batch_full: boolean }>(sql`
      with due as materialized (
        select c.id
        from evidence_collection c
        inner join source_connection s on s.id = c.source_connection_id and s.client_id = c.client_id
        where ${tenant}
          and c.lifecycle in ('candidate', 'live', 'quarantined')
          and (c.expires_at <= ${now} or s.revoked_at is not null)
        order by c.expires_at, c.id
        for update of c skip locked
        limit ${limit + 1}
      ), changed as (
        update evidence_collection c
        set lifecycle = 'expired', title = '[expired collection ' || c.id || ']'
        where c.id in (select id from due limit ${limit})
        returning c.client_id
      )
      select client_id, (select count(*) > ${limit} from due) as batch_full from changed
    `);
    const affected = new Map<number, number>();
    for (const row of updated.rows) affected.set(row.client_id, (affected.get(row.client_id) ?? 0) + 1);
    if (affected.size) {
      await tx.insert(governanceAudit).values([...affected].map(([affectedClientId, count]) => ({
        clientId: affectedClientId,
        action: "retention_enforced",
        entityType: "canonical_retention_batch",
        entityId: `collections:${now.toISOString()}`,
        redactedAfterJson: { evidenceExpired: 0, collectionsExpired: count, intelligenceDecayed: 0 },
        createdAt: now,
      })));
    }
    return { processed: updated.rows.length, batchFull: updated.rows[0]?.batch_full ?? false };
  });
}

async function decayIntelligence(now: Date, clientId?: number, deadline?: Date | number): Promise<BatchProgress> {
  return db.transaction(async (tx) => {
    await applyTransactionLimits(tx, deadline);
    const tenant = clientId === undefined ? sql`true` : sql`i.client_id = ${clientId}`;
    const limit = CANONICAL_RETENTION_LIMITS.intelligence;
    const updated = await tx.execute<{ client_id: number; batch_full: boolean }>(sql`
      with due as materialized (
        select i.id
        from intelligence_record i
        where ${tenant} and i.decay_at <= ${now} and i.lifecycle in ('candidate', 'live')
        order by i.decay_at, i.id
        for update of i skip locked
        limit ${limit + 1}
      ), changed as (
        update intelligence_record i set lifecycle = 'expired'
        where i.id in (select id from due limit ${limit})
        returning i.client_id
      )
      select client_id, (select count(*) > ${limit} from due) as batch_full from changed
    `);
    const affected = new Map<number, number>();
    for (const row of updated.rows) affected.set(row.client_id, (affected.get(row.client_id) ?? 0) + 1);
    if (affected.size) {
      await tx.insert(governanceAudit).values([...affected].map(([affectedClientId, count]) => ({
        clientId: affectedClientId,
        action: "retention_enforced",
        entityType: "canonical_retention_batch",
        entityId: `intelligence:${now.toISOString()}`,
        redactedAfterJson: { evidenceExpired: 0, collectionsExpired: 0, intelligenceDecayed: count },
        createdAt: now,
      })));
    }
    return { processed: updated.rows.length, batchFull: updated.rows[0]?.batch_full ?? false };
  });
}

/**
 * Bounded, resumable retention. `batchFull` represents expected continuation,
 * not failure. The optional absolute deadline is checked between committed
 * chunks; SQL statements remain independently bounded by transaction limits.
 */
export async function enforceCanonicalRetention(
  now = new Date(),
  clientId?: number,
  options: CanonicalRetentionOptions = {},
): Promise<CanonicalRetentionSummary> {
  const deadline = options.deadline instanceof Date ? options.deadline.getTime() : options.deadline;
  const canContinue = () => deadline === undefined || Date.now() < deadline;
  const zero = (): BatchProgress => ({ processed: 0, batchFull: false });
  const evidenceDiscovery = canContinue()
    ? await maintenanceOperation(() => discoverRetentionWork(now, clientId, deadline))
    : { processed: 0, batchFull: true };
  const totals = { evidenceExpired: 0, observationsRemoved: 0, themesRemoved: 0, artifactCitationsRedacted: 0 };
  let chunks = 0;
  let workBatchFull = false;
  while (chunks < CANONICAL_RETENTION_LIMITS.chunks && canContinue()) {
    const chunk = await maintenanceOperation(() => processRetentionChunk(now, clientId, deadline));
    if (!chunk.claimed) break;
    chunks += 1;
    totals.evidenceExpired += chunk.evidenceExpired;
    totals.observationsRemoved += chunk.observationsRemoved;
    totals.themesRemoved += chunk.themesRemoved;
    totals.artifactCitationsRedacted += chunk.artifactCitationsRedacted;
    workBatchFull ||= chunk.batchFull;
  }
  workBatchFull ||= chunks === CANONICAL_RETENTION_LIMITS.chunks;

  const collections = canContinue()
    ? await maintenanceOperation(() => expireCollections(now, clientId, deadline))
    : { processed: 0, batchFull: true };
  const intelligence = canContinue()
    ? await maintenanceOperation(() => decayIntelligence(now, clientId, deadline))
    : { processed: 0, batchFull: true };

  const deadlineReached = !canContinue();
  const progress = {
    evidenceDiscovery,
    retentionWork: deadlineReached && chunks === 0 ? { ...zero(), batchFull: true } : { processed: chunks, batchFull: workBatchFull },
    collections,
    intelligence,
  };
  return {
    ...totals,
    collectionsExpired: collections.processed,
    intelligenceDecayed: intelligence.processed,
    batchFull: deadlineReached || Object.values(progress).some((item) => item.batchFull),
    deadlineReached,
    progress,
  };
}
