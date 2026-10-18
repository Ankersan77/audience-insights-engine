import { and, asc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { SourceAcquisitionJob as DomainAcquisitionJob, SourceAcquisitionRequest } from "@/src/connectors/contracts";
import type { RightsDeclaration, SourceClass, SourceConnectionPolicy } from "@/src/core/contracts";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "@/src/connectors/sourcePolicy";
import { db } from "@/src/db/client";
import { sourceAcquisitionJob, sourceAcquisitionReceipt, sourceConnection } from "@/src/db/schema";

export type ClaimedAcquisition = {
  databaseJobId: number;
  sourceConnectionId: number;
  connectorId: string;
  connectorVersion: string;
  sourceClass: SourceClass;
  configuration: Readonly<Record<string, unknown>>;
  policy: SourceConnectionPolicy;
  rights: RightsDeclaration;
  retentionDays: number;
  rawRetentionHours: number;
  job: DomainAcquisitionJob;
};

export type AcquisitionClaim =
  | { kind: "claimed"; value: ClaimedAcquisition }
  | { kind: "blocked"; errorCode: string }
  | { kind: "unavailable" };

export const ACQUISITION_MAINTENANCE_MAX_BATCH_SIZE = 100;

export type AcquisitionBatch<T> = {
  items: T[];
  batchFull: boolean;
};
export type AcquisitionDispatchLeaseBatch = AcquisitionBatch<number> & { leaseUntil: Date };
export type AcquisitionCleanupProgress = {
  processed: number;
  revokedCancelled: number;
  unavailableFailed: number;
  batchFull: boolean;
};
export type StaleAcquisitionCleanupProgress = {
  processed: number;
  batchFull: boolean;
};
type AcquisitionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function boundedMaintenanceLimit(limit: number): number {
  if (!Number.isFinite(limit)) return ACQUISITION_MAINTENANCE_MAX_BATCH_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), ACQUISITION_MAINTENANCE_MAX_BATCH_SIZE);
}

async function applyMaintenanceQueryLimits(tx: AcquisitionTransaction, deadline?: Date): Promise<void> {
  const remainingMs = deadline ? deadline.getTime() - Date.now() : 10_000;
  if (remainingMs <= 0) throw new Error("maintenance-stage-deadline-exceeded");
  const statementTimeoutMs = Math.max(1, Math.min(10_000, Math.trunc(remainingMs)));
  await tx.execute(sql`select set_config('lock_timeout', '1000ms', true)`);
  await tx.execute(sql`select set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)`);
}

export const ACQUISITION_DISPATCH_LEASE_MS = 5 * 60_000;

/** Atomically leases one bounded, oldest-first dispatch page without holding locks across enqueue. */
export async function claimQueuedAcquisitionJobIds(
  now: Date,
  limit = ACQUISITION_MAINTENANCE_MAX_BATCH_SIZE,
  deadline?: Date,
): Promise<AcquisitionDispatchLeaseBatch> {
  const batchLimit = boundedMaintenanceLimit(limit);
  const leaseUntil = new Date(now.getTime() + ACQUISITION_DISPATCH_LEASE_MS);
  return db.transaction(async (tx) => {
    await applyMaintenanceQueryLimits(tx, deadline);
    const claimed = await tx.execute<{ id: number }>(sql`
      with candidates as materialized (
        select j.id
        from source_acquisition_job j
        inner join source_connection s on s.id = j.source_connection_id and s.client_id = j.client_id
        where j.status = 'queued'
          and (j.dispatch_lease_until is null or j.dispatch_lease_until <= ${now})
          and s.revoked_at is null
          and s.health <> 'unavailable'
        order by j.requested_at, j.id
        for update of j skip locked
        limit ${batchLimit}
      ), leased as (
        update source_acquisition_job j
        set dispatch_lease_until = ${leaseUntil}
        from candidates c
        where j.id = c.id and j.status = 'queued'
        returning j.id, j.requested_at
      )
      select id from leased order by requested_at, id
    `);
    const backlog = await tx.execute<{ batch_full: boolean }>(sql`
      select exists (
        select 1
        from source_acquisition_job j
        inner join source_connection s on s.id = j.source_connection_id and s.client_id = j.client_id
        where j.status = 'queued'
          and (j.dispatch_lease_until is null or j.dispatch_lease_until <= ${now})
          and s.revoked_at is null
          and s.health <> 'unavailable'
      ) as batch_full
    `);
    return {
      items: claimed.rows.map((row) => row.id),
      batchFull: Boolean(backlog.rows[0]?.batch_full),
      leaseUntil,
    };
  });
}

/** Atomically fails one bounded oldest-first batch of abandoned running jobs. */
export async function cleanupStaleRunningAcquisitions(
  before: Date,
  now: Date,
  limit = ACQUISITION_MAINTENANCE_MAX_BATCH_SIZE,
  deadline?: Date,
): Promise<StaleAcquisitionCleanupProgress> {
  const batchLimit = boundedMaintenanceLimit(limit);
  return db.transaction(async (tx) => {
    await applyMaintenanceQueryLimits(tx, deadline);
    const candidates = await tx.select({
      id: sourceAcquisitionJob.id,
      clientId: sourceAcquisitionJob.clientId,
      sourceConnectionId: sourceAcquisitionJob.sourceConnectionId,
    }).from(sourceAcquisitionJob)
      .where(and(
        eq(sourceAcquisitionJob.status, "running"),
        isNotNull(sourceAcquisitionJob.startedAt),
        lt(sourceAcquisitionJob.startedAt, before),
      ))
      .orderBy(asc(sourceAcquisitionJob.startedAt), asc(sourceAcquisitionJob.id))
      .limit(batchLimit + 1)
      .for("update", { of: sourceAcquisitionJob, skipLocked: true });
    const selected = candidates.slice(0, batchLimit);
    if (selected.length === 0) return { processed: 0, batchFull: false };
    const selectedIds = selected.map((job) => job.id);
    const failed = await tx.update(sourceAcquisitionJob).set({ status: "failed", finishedAt: now }).where(and(
      inArray(sourceAcquisitionJob.id, selectedIds),
      eq(sourceAcquisitionJob.status, "running"),
    )).returning({
      id: sourceAcquisitionJob.id,
      clientId: sourceAcquisitionJob.clientId,
      sourceConnectionId: sourceAcquisitionJob.sourceConnectionId,
    });
    if (failed.length > 0) {
      await tx.insert(sourceAcquisitionReceipt).values(failed.map((job) => ({
        clientId: job.clientId,
        jobId: job.id,
        status: "failed" as const,
        acquiredCount: 0,
        rejectedCount: 0,
        safeArtifactRefs: [],
        errorCode: "worker-lease-expired",
        completedAt: now,
      }))).onConflictDoNothing({ target: sourceAcquisitionReceipt.jobId });
      const sourceIds = [...new Set(failed.map((job) => job.sourceConnectionId))];
      await tx.update(sourceConnection).set({ health: "degraded" }).where(and(
        inArray(sourceConnection.id, sourceIds),
        ne(sourceConnection.health, "unavailable"),
      ));
    }
    return { processed: failed.length, batchFull: candidates.length > batchLimit };
  });
}

/** Resolves one bounded oldest-first batch whose source is revoked or unavailable. */
export async function cleanupRevokedSourceAcquisitions(
  now: Date,
  limit = ACQUISITION_MAINTENANCE_MAX_BATCH_SIZE,
  deadline?: Date,
): Promise<AcquisitionCleanupProgress> {
  const batchLimit = boundedMaintenanceLimit(limit);
  return db.transaction(async (tx) => {
    await applyMaintenanceQueryLimits(tx, deadline);
    const candidates = await tx.select({
      id: sourceAcquisitionJob.id,
      clientId: sourceAcquisitionJob.clientId,
      revokedAt: sourceConnection.revokedAt,
    }).from(sourceAcquisitionJob)
      .innerJoin(sourceConnection, and(
        eq(sourceConnection.id, sourceAcquisitionJob.sourceConnectionId),
        eq(sourceConnection.clientId, sourceAcquisitionJob.clientId),
        sql`(${sourceConnection.revokedAt} is not null or ${sourceConnection.health} = 'unavailable')`,
      ))
      .where(inArray(sourceAcquisitionJob.status, ["queued", "running"]))
      .orderBy(asc(sourceAcquisitionJob.requestedAt), asc(sourceAcquisitionJob.id))
      .limit(batchLimit + 1)
      .for("update", { of: sourceAcquisitionJob, skipLocked: true });
    const selected = candidates.slice(0, batchLimit);
    if (selected.length === 0) return { processed: 0, revokedCancelled: 0, unavailableFailed: 0, batchFull: false };
    const revokedIds = selected.filter((row) => row.revokedAt).map((row) => row.id);
    const unavailableIds = selected.filter((row) => !row.revokedAt).map((row) => row.id);
    const cancelled = revokedIds.length > 0 ? await tx.update(sourceAcquisitionJob).set({
      status: "cancelled", cancelledAt: now, finishedAt: now,
    }).where(and(inArray(sourceAcquisitionJob.id, revokedIds), inArray(sourceAcquisitionJob.status, ["queued", "running"])))
      .returning({ id: sourceAcquisitionJob.id, clientId: sourceAcquisitionJob.clientId }) : [];
    const failed = unavailableIds.length > 0 ? await tx.update(sourceAcquisitionJob).set({
      status: "failed", finishedAt: now,
    }).where(and(inArray(sourceAcquisitionJob.id, unavailableIds), inArray(sourceAcquisitionJob.status, ["queued", "running"])))
      .returning({ id: sourceAcquisitionJob.id, clientId: sourceAcquisitionJob.clientId }) : [];
    const completed = [
      ...cancelled.map((job) => ({ ...job, status: "cancelled" as const, errorCode: "source-revoked" })),
      ...failed.map((job) => ({ ...job, status: "failed" as const, errorCode: "source-unavailable" })),
    ];
    if (completed.length > 0) {
      await tx.insert(sourceAcquisitionReceipt).values(completed.map((job) => ({
        clientId: job.clientId,
        jobId: job.id,
        status: job.status,
        acquiredCount: 0,
        rejectedCount: 0,
        safeArtifactRefs: [],
        errorCode: job.errorCode,
        completedAt: now,
      }))).onConflictDoNothing({ target: sourceAcquisitionReceipt.jobId });
    }
    return {
      processed: completed.length,
      revokedCancelled: cancelled.length,
      unavailableFailed: failed.length,
      batchFull: candidates.length > batchLimit,
    };
  });
}

export async function claimAcquisitionJob(id: number, now = new Date()): Promise<AcquisitionClaim> {
  return db.transaction(async (tx) => {
    const [pending] = await tx.select().from(sourceAcquisitionJob).where(and(eq(sourceAcquisitionJob.id, id), eq(sourceAcquisitionJob.status, "queued"))).limit(1);
    if (!pending) return { kind: "unavailable" } as const;
    const job = pending;
    // Source first, then job: the same lock order as completion and revocation.
    const [source] = await tx.select().from(sourceConnection).where(and(eq(sourceConnection.id, job.sourceConnectionId), eq(sourceConnection.clientId, job.clientId))).limit(1).for("update");
    if (!source) throw new Error("source-connection-not-found");
    const sourceClass = source.sourceClass as SourceClass;
    const policy = readSourceConnectionPolicy(source.configurationJson);
    const blocked = sourcePolicyFailure({ health: source.health, rights: source.rightsJson as RightsDeclaration, policy, request: job.requestJson as SourceAcquisitionRequest, dataClassification: sourceClassification(sourceClass), now: now.toISOString() });
    if (blocked) {
      const [failed] = await tx.update(sourceAcquisitionJob).set({ status: "failed", finishedAt: now }).where(and(eq(sourceAcquisitionJob.id, id), eq(sourceAcquisitionJob.status, "queued"))).returning({ id: sourceAcquisitionJob.id });
      if (!failed) return { kind: "unavailable" } as const;
      await tx.insert(sourceAcquisitionReceipt).values({ clientId: job.clientId, jobId: job.id, status: "failed", acquiredCount: 0, rejectedCount: 0, safeArtifactRefs: [], errorCode: blocked, completedAt: now });
      await tx.update(sourceConnection).set({ health: "unavailable" }).where(and(eq(sourceConnection.id, source.id), eq(sourceConnection.clientId, source.clientId)));
      return { kind: "blocked", errorCode: blocked } as const;
    }
    const [claimed] = await tx.update(sourceAcquisitionJob).set({
      status: "running",
      startedAt: now,
      dispatchLeaseUntil: null,
    }).where(and(eq(sourceAcquisitionJob.id, id), eq(sourceAcquisitionJob.status, "queued"))).returning();
    if (!claimed) return { kind: "unavailable" } as const;
    return { kind: "claimed", value: {
      databaseJobId: job.id,
      sourceConnectionId: source.id,
      connectorId: source.connectorId,
      connectorVersion: source.connectorVersion,
      sourceClass,
      configuration: source.configurationJson as Readonly<Record<string, unknown>>,
      policy,
      rights: source.rightsJson as RightsDeclaration,
      retentionDays: source.retentionDays,
      rawRetentionHours: source.rawRetentionHours,
      job: {
        id: String(job.id), clientId: String(job.clientId), sourceId: String(source.id), adapterId: source.connectorId,
        credentialRef: source.credentialRef ? { provider: "secret-store", key: source.credentialRef } : undefined,
        dataClassification: sourceClassification(sourceClass), request: job.requestJson as SourceAcquisitionRequest,
        idempotencyKey: job.idempotencyKey, requestedAt: job.requestedAt.toISOString(),
      },
    } } as const;
  });
}

export async function isAcquisitionCancelled(id: number): Promise<boolean> {
  const [row] = await db.select({ status: sourceAcquisitionJob.status }).from(sourceAcquisitionJob).where(eq(sourceAcquisitionJob.id, id)).limit(1);
  return row?.status === "cancelled";
}

export async function cancelAcquisitionJob(input: { clientId: number; id: number; now: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(sourceAcquisitionJob).set({ status: "cancelled", cancelledAt: input.now, finishedAt: input.now }).where(and(
      eq(sourceAcquisitionJob.id, input.id), eq(sourceAcquisitionJob.clientId, input.clientId),
      inArray(sourceAcquisitionJob.status, ["queued", "running"]),
    )).returning({ id: sourceAcquisitionJob.id, previousStartedAt: sourceAcquisitionJob.startedAt });
    if (!updated) return false;
    const [receipt] = await tx.select({ id: sourceAcquisitionReceipt.id }).from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, input.id)).limit(1);
    if (receipt) return false;
    await tx.insert(sourceAcquisitionReceipt).values({ clientId: input.clientId, jobId: input.id, status: "cancelled", acquiredCount: 0, rejectedCount: 0, safeArtifactRefs: [], errorCode: "cancelled-by-user", completedAt: input.now });
    return true;
  });
}
