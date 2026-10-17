import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { eq } from "drizzle-orm";
import { PgBoss, type JobWithMetadata } from "pg-boss";
import type { Pool } from "pg";
import type { AdapterRunResult } from "../src/evidence/sdk";
import { AcquisitionAdapterRegistry } from "../src/evidence/registry";
import {
  appUser,
  authSession,
  canonicalEvidence,
  clientMembership,
  evidenceCollection,
  sourceAcquisitionJob,
  sourceAcquisitionReceipt,
} from "../src/db/schema";

type LifecycleFixture = {
  tenant: { id: number; slug: string };
  source: { id: number; connectorId: string };
  input: {
    operation: string;
    request: Readonly<Record<string, unknown>>;
    result: AdapterRunResult;
  };
};

async function waitForTerminalJob<T>(boss: PgBoss, queue: string, id: string, timeoutMs = 20_000): Promise<JobWithMetadata<T>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [job] = await boss.findJobs<T>(queue, { id });
    if (job?.state === "completed") return job;
    if (job?.state === "failed" || job?.state === "cancelled") throw new Error(`${queue}-integration-job-${job.state}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${queue}-integration-job-timeout`);
}

// This is a bounded lifecycle proof against synthetic data, not production-operation evidence.
export async function runCanonicalWorkerRuntimeCases(
  t: TestContext,
  db: typeof import("../src/db/client").db,
  probe: Pool,
  connectionString: string,
  fixture: () => Promise<LifecycleFixture>,
) {
  await t.test("neutral runtime executes and gracefully drains canonical workers only", async () => {
    const { setAcquisitionBudget } = await import("../src/db/queries/acquisition_budget");
    const { ACQUISITION_QUEUE_NAME } = await import("../src/workers/acquisitionQueue");
    const { CANONICAL_MAINTENANCE_QUEUE } = await import("../src/workers/canonicalMaintenance");
    const { startCanonicalWorkers } = await import("../src/workers/canonicalWorkers");
    const { createWorkerRuntimeManager, installWorkerShutdown } = await import("../src/workers/pgBossRuntime");
    const { SYNTHESIS_MAINTENANCE_QUEUE } = await import("../src/workers/synthesisMaintenance");
    const f = await fixture();
    const fixtureKey = randomUUID();
    const registry = new AcquisitionAdapterRegistry();
    const plan = { currency: "DKK", maxCostMicros: 0, maxRecords: 1, maxRequests: 1 };
    registry.register(f.source.connectorId, () => ({
      id: f.source.connectorId,
      plan: () => plan,
      async run(job, context) {
        context.acquisition!.authorizeRequest({ costMicros: 0, maxRecords: 1 });
        return { ...f.input.result, receipt: { ...f.input.result.receipt, jobId: job.id } };
      },
    }));
    await setAcquisitionBudget(f.tenant.slug, {
      currency: "DKK", dailyCostMicros: 0, dailyRecords: 1, dailyRequests: 1, enabled: true,
    });
    const [databaseJob] = await db.insert(sourceAcquisitionJob).values({
      clientId: f.tenant.id,
      sourceConnectionId: f.source.id,
      operation: f.input.operation,
      requestJson: f.input.request,
      idempotencyKey: randomUUID(),
    }).returning();

    const [user] = await db.insert(appUser).values({
      email: `canonical-runtime-${fixtureKey}@example.invalid`,
      name: "Synthetic canonical runtime user",
      role: "viewer",
      ssoSubjectId: randomUUID(),
    }).returning();
    await db.insert(clientMembership).values({ clientId: f.tenant.id, userId: user.id, role: "viewer" });
    const expiredSessionHash = `canonical-runtime-${randomUUID()}`;
    await db.insert(authSession).values({
      tokenHash: expiredSessionHash,
      clientId: f.tenant.id,
      userId: user.id,
      createdAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });

    const runtimeErrors: string[] = [];
    const runtime = createWorkerRuntimeManager({
      connectionString,
      createBoss(value) {
        assert.equal(value, connectionString);
        return new PgBoss({ connectionString: value, schedule: false, supervise: false });
      },
      onRuntimeError(code) { runtimeErrors.push(code); },
    });
    let boss: PgBoss | null = null;
    let stopped = false;
    const queueJobIds: { queue: string; id: string }[] = [];
    try {
      boss = await runtime.get();
      assert.equal(await boss.getQueue("research-run"), null);
      assert.equal(await boss.getQueue("market-research-monitoring-scheduler"), null);
      await startCanonicalWorkers(boss, {
        registry,
        runtime: { async resolveCredential() { throw new Error("credential-resolution-not-expected"); } },
      });

      assert.deepEqual(boss.getWipData().map((worker) => worker.name).sort(), [
        ACQUISITION_QUEUE_NAME,
        CANONICAL_MAINTENANCE_QUEUE,
        SYNTHESIS_MAINTENANCE_QUEUE,
      ].sort());
      const canonicalSchedule = await boss.getSchedule(CANONICAL_MAINTENANCE_QUEUE);
      assert.equal(canonicalSchedule?.cron, "*/15 * * * *");
      assert.equal(canonicalSchedule?.timezone, "UTC");
      assert.equal(canonicalSchedule?.options?.missed, "once");
      const synthesisSchedule = await boss.getSchedule(SYNTHESIS_MAINTENANCE_QUEUE);
      assert.equal(synthesisSchedule?.cron, "*/5 * * * *");
      assert.equal(synthesisSchedule?.timezone, "UTC");

      const acquisitionQueueJobId = await boss.send(ACQUISITION_QUEUE_NAME, { databaseJobId: databaseJob.id });
      assert.ok(acquisitionQueueJobId);
      queueJobIds.push({ queue: ACQUISITION_QUEUE_NAME, id: acquisitionQueueJobId });
      await waitForTerminalJob(boss, ACQUISITION_QUEUE_NAME, acquisitionQueueJobId);
      const [completedAcquisition] = await db.select().from(sourceAcquisitionJob).where(eq(sourceAcquisitionJob.id, databaseJob.id));
      assert.equal(completedAcquisition.status, "succeeded");
      const [receipt] = await db.select().from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, databaseJob.id));
      assert.equal(receipt.status, "succeeded");
      assert.equal(receipt.acquiredCount, 1);
      const [collection] = await db.select().from(evidenceCollection).where(eq(evidenceCollection.acquisitionJobId, databaseJob.id));
      const [evidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.collectionId, collection.id));
      assert.ok(evidence);

      const expiredAt = new Date(Date.now() - 1_000);
      await db.update(canonicalEvidence).set({ expiresAt: expiredAt }).where(eq(canonicalEvidence.id, evidence.id));
      await db.update(evidenceCollection).set({ expiresAt: expiredAt }).where(eq(evidenceCollection.id, collection.id));
      const maintenanceQueueJobId = await boss.send(CANONICAL_MAINTENANCE_QUEUE, null);
      assert.ok(maintenanceQueueJobId);
      queueJobIds.push({ queue: CANONICAL_MAINTENANCE_QUEUE, id: maintenanceQueueJobId });
      const maintenanceJob = await waitForTerminalJob<null>(boss, CANONICAL_MAINTENANCE_QUEUE, maintenanceQueueJobId);
      const maintenanceOutput = maintenanceJob.output as unknown as {
        expiredSessionsRemoved: number;
        retention: { evidenceExpired: number; collectionsExpired: number };
        staleAcquisitions: number;
        dispatched: number;
      };
      assert.equal(maintenanceOutput.expiredSessionsRemoved, 1);
      assert.equal(maintenanceOutput.retention.evidenceExpired, 1);
      assert.equal(maintenanceOutput.retention.collectionsExpired, 1);
      assert.equal(maintenanceOutput.staleAcquisitions, 0);
      assert.equal(maintenanceOutput.dispatched, 0);
      assert.equal((await db.select().from(authSession).where(eq(authSession.tokenHash, expiredSessionHash))).length, 0);
      const [expiredEvidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, evidence.id));
      const [expiredCollection] = await db.select().from(evidenceCollection).where(eq(evidenceCollection.id, collection.id));
      assert.equal(expiredEvidence.lifecycle, "expired");
      assert.equal(expiredEvidence.sourceContent, "[expired: retained evidence content removed]");
      assert.equal(expiredCollection.lifecycle, "expired");

      const synthesisQueueJobId = await boss.send(SYNTHESIS_MAINTENANCE_QUEUE, null);
      assert.ok(synthesisQueueJobId);
      queueJobIds.push({ queue: SYNTHESIS_MAINTENANCE_QUEUE, id: synthesisQueueJobId });
      const synthesisJob = await waitForTerminalJob<null>(boss, SYNTHESIS_MAINTENANCE_QUEUE, synthesisQueueJobId);
      assert.deepEqual(synthesisJob.output, {
        examinedClients: 0,
        reconciledAttempts: 0,
        busyClients: 0,
        failedClients: 0,
        batchFull: false,
      });

      assert.equal(await boss.getQueue("research-run"), null);
      assert.equal(await boss.getQueue("market-research-monitoring-scheduler"), null);
      await boss.unschedule(CANONICAL_MAINTENANCE_QUEUE);
      await boss.unschedule(SYNTHESIS_MAINTENANCE_QUEUE);
      for (const job of queueJobIds) await boss.deleteJob(job.queue, job.id);
      queueJobIds.length = 0;

      const shutdownEvents: unknown[] = [];
      const registeredSignals: string[] = [];
      const exitCodes: number[] = [];
      const shutdown = installWorkerShutdown(boss, {
        timeoutMs: 5_000,
        registerSignal(signal) { registeredSignals.push(signal); },
        exit(code) { exitCodes.push(code); },
        log(event, fields) { shutdownEvents.push([event, fields]); },
      });
      assert.deepEqual(registeredSignals, ["SIGTERM", "SIGINT"]);
      await shutdown("SIGTERM");
      stopped = true;
      assert.deepEqual(shutdownEvents, [
        ["shutdown-started", { signal: "SIGTERM" }],
        ["shutdown-drained", { signal: "SIGTERM" }],
      ]);
      assert.deepEqual(exitCodes, [0]);
      assert.deepEqual(runtimeErrors, []);
      assert.equal(Number((await probe.query(
        "select count(*) row_count from pgboss.job where name = any($1::text[]) and state::text in ('created','retry','active')",
        [[ACQUISITION_QUEUE_NAME, CANONICAL_MAINTENANCE_QUEUE, SYNTHESIS_MAINTENANCE_QUEUE]],
      )).rows[0].row_count), 0);
    } finally {
      if (boss && !stopped) {
        await boss.unschedule(CANONICAL_MAINTENANCE_QUEUE).catch(() => undefined);
        await boss.unschedule(SYNTHESIS_MAINTENANCE_QUEUE).catch(() => undefined);
        for (const job of queueJobIds) await boss.deleteJob(job.queue, job.id).catch(() => undefined);
        await boss.stop({ graceful: true, timeout: 5_000 }).catch(() => undefined);
      }
      // Fixture rows intentionally remain as synthetic integration evidence, matching the parent suite.
    }
  });
}
