import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { client, governanceAudit, synthesisAuthorization } from "../src/db/schema";
import { withSynthesisBudget } from "../src/abilities/governedSynthesis";
import type { SynthesisSpendPlan, SynthesisAttempt } from "../src/abilities/synthesisBudget";
import type { ResearchSynthesisInput } from "../src/abilities/synthesis";

// Called from the existing migrated integration suite, not a second concurrent migrator.
export async function runSynthesisBudgetCases(t: TestContext, db: typeof import("../src/db/client").db, probe: Pool) {
  const { setSynthesisBudget, inspectSynthesisBudget, reserveSynthesisAttempt, dispatchSynthesisAttempt,
    finishSynthesisAttempt, reconcileSynthesisAttempts, reconcileDueSynthesisAttempts, synthesisSpendLedger } = await import("../src/db/queries/synthesis_budget");
  const settings = { currency: "DKK", dailyCostMicros: 100, dailyRequests: 2, enabled: true };
  const plan = (): SynthesisSpendPlan => ({ currency: "DKK", maxCostMicros: 50, providerId: "synthetic", providerVersion: "1",
    model: "fixture-model", approvalReference: "acceptance:synthetic-only", bindingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxInputBytes: 100_000, maxOutputTokens: 2000, maxDurationMs: 10_000 });
  const tenant = async () => (await db.insert(client).values({ name: "Synthetic synthesis-budget tenant", slug: `synthesis-${randomUUID()}` }).returning())[0];
  const attempt = (clientId: number, patch: Partial<SynthesisSpendPlan> = {}): SynthesisAttempt => ({ clientId: String(clientId),
    attemptKey: randomUUID(), abilityId: "market-category-diagnosis", inputDigest: "a".repeat(64), plan: { ...plan(), ...patch } });
  const request = (clientId: number): ResearchSynthesisInput => ({ clientId: String(clientId), abilityId: "market-category-diagnosis",
    question: "Synthetic private decision, not real client data", evidence: [], market: "DK", language: "da",
    context: { clientId: String(clientId), market: "DK", language: "da", marketTwin: [], solution: { id: "fixture", version: 1,
      markets: ["DK"], languages: ["da"], enabledAbilities: [], reviewRoles: {}, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } },
  });
  async function blocked(count: number) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const result = await probe.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0");
      if (result.rows[0].n >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Expected blocked synthesis-budget operations");
  }

  await t.test("synthesis admission is opt-in and serializes one daily allowance across concurrent calls", async () => {
    const owner = await tenant();
    await assert.rejects(reserveSynthesisAttempt(attempt(owner.id)), /synthesis-budget-not-enabled/);
    assert.equal((await inspectSynthesisBudget(owner.slug)).policy, null);
    await setSynthesisBudget(owner.slug, settings);
    await assert.rejects(reserveSynthesisAttempt(attempt(owner.id, { currency: "EUR" })), /currency-mismatch/);
    await assert.rejects(reserveSynthesisAttempt(attempt(owner.id, { bindingExpiresAt: new Date(Date.now() - 60_000).toISOString() })), /binding-expired/);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveSynthesisAttempt(attempt(owner.id))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(results.filter((result) => result.status === "rejected").length, 3);
    const view = await inspectSynthesisBudget(owner.slug);
    assert.equal(view.usage.authorizedCostMicros, "100"); assert.equal(view.usage.authorizedRequests, "2");
    await assert.rejects(setSynthesisBudget(owner.slug, { ...settings, currency: "EUR" }), /currency-change-requires-migration/);
    const other = await tenant(); await setSynthesisBudget(other.slug, settings);
    const permit = await reserveSynthesisAttempt(attempt(other.id));
    await assert.rejects(dispatchSynthesisAttempt({ ...permit, clientId: String(owner.id) }), /not-dispatchable/);
    await assert.rejects(finishSynthesisAttempt({ ...permit, clientId: String(owner.id) }, "succeeded"), /not-found/);
    assert.equal((await inspectSynthesisBudget(other.slug)).usage.authorizedRequests, "1");
  });

  await t.test("attempt and dispatch permits cannot replay and all terminal outcomes remain charged", async () => {
    const owner = await tenant(); await setSynthesisBudget(owner.slug, { ...settings, dailyCostMicros: 1000, dailyRequests: 20 });
    const original = attempt(owner.id);
    const permit = await reserveSynthesisAttempt(original);
    await assert.rejects(reserveSynthesisAttempt(original), /already-reserved/);
    await assert.rejects(finishSynthesisAttempt(permit, "succeeded"), /not-dispatched/);
    const claimed = await Promise.allSettled([dispatchSynthesisAttempt(permit), dispatchSynthesisAttempt(permit)]);
    assert.equal(claimed.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await finishSynthesisAttempt(permit, "succeeded")).accepted, true);
    assert.equal((await finishSynthesisAttempt(permit, "succeeded")).accepted, false);
    await assert.rejects(dispatchSynthesisAttempt(permit), /not-dispatchable/);
    for (const outcome of ["failed", "cancelled", "unknown"] as const) {
      const next = await reserveSynthesisAttempt(attempt(owner.id));
      await dispatchSynthesisAttempt(next); await finishSynthesisAttempt(next, outcome);
    }
    const view = await inspectSynthesisBudget(owner.slug);
    assert.equal(view.usage.authorizedCostMicros, "200"); assert.equal(view.usage.authorizedRequests, "4");
    const audits = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, owner.id), eq(governanceAudit.action, "finish_synthesis")));
    assert.equal(audits.length, 4);
  });

  await t.test("budget revisions revoke pending dispatch and in-flight result authorization without refund", async () => {
    const owner = await tenant(); await setSynthesisBudget(owner.slug, settings);
    const reserved = await reserveSynthesisAttempt(attempt(owner.id));
    const dispatched = await reserveSynthesisAttempt(attempt(owner.id)); await dispatchSynthesisAttempt(dispatched);
    await setSynthesisBudget(owner.slug, { ...settings, enabled: false });
    await assert.rejects(dispatchSynthesisAttempt(reserved), /budget-changed/);
    assert.equal((await finishSynthesisAttempt(dispatched, "succeeded")).accepted, false);
    await finishSynthesisAttempt(reserved, "cancelled");
    const view = await inspectSynthesisBudget(owner.slug);
    assert.equal(view.policy?.version, 2); assert.equal(view.usage.authorizedCostMicros, "100");
    assert.equal(view.usage.unknownAttempts, "1");
    await setSynthesisBudget(owner.slug, settings);
    await assert.rejects(reserveSynthesisAttempt(attempt(owner.id)), /daily-limit/);
  });

  await t.test("disabling the budget ahead of a queued admission wins the tenant lock", async () => {
    const owner = await tenant(); await setSynthesisBudget(owner.slug, settings);
    const barrier = await probe.connect();
    try {
      await barrier.query("begin"); await barrier.query("select pg_advisory_xact_lock(73008, $1)", [owner.id]);
      const disable = setSynthesisBudget(owner.slug, { ...settings, enabled: false });
      await blocked(1);
      const rejected = assert.rejects(reserveSynthesisAttempt(attempt(owner.id)), /not-enabled/);
      await blocked(2); await barrier.query("commit"); await disable; await rejected;
      assert.equal((await inspectSynthesisBudget(owner.slug)).usage.authorizedRequests, "0");
    } finally { await barrier.query("rollback"); barrier.release(); }
  });

  await t.test("expired/crashed attempts reconcile to terminal metadata but never reusable budget", async () => {
    const owner = await tenant(); await setSynthesisBudget(owner.slug, settings);
    const reserved = await reserveSynthesisAttempt(attempt(owner.id));
    const dispatched = await reserveSynthesisAttempt(attempt(owner.id)); await dispatchSynthesisAttempt(dispatched);
    await db.update(synthesisAuthorization).set({ dispatchBy: sql`clock_timestamp() - interval '1 second'`, executionDeadline: sql`clock_timestamp() - interval '1 second'` }).where(eq(synthesisAuthorization.clientId, owner.id));
    assert.equal((await inspectSynthesisBudget(owner.slug)).usage.expiredUnresolvedAttempts, "2");
    await assert.rejects(dispatchSynthesisAttempt(reserved), /expired/);
    assert.equal(await reconcileSynthesisAttempts(owner.slug), 2); assert.equal(await reconcileSynthesisAttempts(owner.slug), 0);
    assert.equal((await finishSynthesisAttempt(dispatched, "succeeded")).accepted, false);
    const rows = await db.select().from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, owner.id));
    assert.deepEqual(rows.map((row) => row.status).sort(), ["cancelled", "unknown"]);
    await assert.rejects(reserveSynthesisAttempt(attempt(owner.id)), /daily-limit/);
    assert.equal((await inspectSynthesisBudget(owner.slug)).usage.expiredUnresolvedAttempts, "0");
  });

  await t.test("expiry while completion waits on audit insertion rejects the result and corrects audit", async () => {
    const owner = await tenant(); await setSynthesisBudget(owner.slug, settings);
    const permit = await reserveSynthesisAttempt(attempt(owner.id)); await dispatchSynthesisAttempt(permit);
    await db.update(synthesisAuthorization).set({ executionDeadline: new Date(Date.now() + 500) }).where(eq(synthesisAuthorization.id, Number(permit.id)));
    const barrier = await probe.connect();
    try {
      await barrier.query("begin"); await barrier.query("lock table governance_audit in access exclusive mode");
      const finished = finishSynthesisAttempt(permit, "succeeded");
      await blocked(1); await new Promise((resolve) => setTimeout(resolve, 550));
      await barrier.query("commit"); assert.equal((await finished).accepted, false);
      const [row] = await db.select().from(synthesisAuthorization).where(eq(synthesisAuthorization.id, Number(permit.id)));
      assert.equal(row.status, "unknown");
      const [entry] = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, owner.id), eq(governanceAudit.action, "finish_synthesis")));
      assert.deepEqual(entry.redactedAfterJson, { status: "unknown", resultAuthorized: false });
    } finally { await barrier.query("rollback"); barrier.release(); }
  });

  await t.test("the actual governance wrapper reserves before credentials and suppresses revoked late output", async () => {
    const owner = await tenant(); const data = request(owner.id); let calls = 0; let credentials = 0;
    const provider = (during?: () => Promise<void>) => withSynthesisBudget({ id: "synthetic", version: "1", ledger: synthesisSpendLedger, plan,
      async createProvider() {
        credentials++;
        const view = await inspectSynthesisBudget(owner.slug); assert.ok(Number(view.usage.authorizedRequests) > 0);
        const rows = await db.select().from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, owner.id));
        assert.ok(rows.some((row) => row.status === "dispatched"));
        return { id: "synthetic", version: "1", async synthesize() { calls++; await during?.(); return { privateResult: "synthetic" }; } };
      },
    });
    await assert.rejects(provider().synthesize(data), /governed-synthesis-unavailable/);
    assert.equal(credentials, 0); assert.equal(calls, 0);
    await setSynthesisBudget(owner.slug, settings);
    assert.deepEqual(await provider().synthesize(data), { privateResult: "synthetic" });
    await assert.rejects(provider(async () => setSynthesisBudget(owner.slug, { ...settings, enabled: false })).synthesize(data), /governed-synthesis-unavailable/);
    assert.equal(calls, 2); assert.equal(credentials, 2);
    const view = await inspectSynthesisBudget(owner.slug);
    assert.equal(view.usage.authorizedCostMicros, "100"); assert.equal(view.usage.unknownAttempts, "1");
    const rows = await db.select().from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, owner.id));
    const audits = await db.select().from(governanceAudit).where(eq(governanceAudit.clientId, owner.id));
    assert.ok(!JSON.stringify({ rows, audits }).includes("Synthetic private decision"));
    assert.ok(!JSON.stringify({ rows, audits }).includes("privateResult"));
  });

  await t.test("scheduled reconciliation drains bounded historical batches and preserves active/terminal work", async () => {
    const owner = await tenant();
    await setSynthesisBudget(owner.slug, { ...settings, dailyRequests: 100, dailyCostMicros: 5000 });
    const permits = [];
    for (let i = 0; i < 51; i++) permits.push(await reserveSynthesisAttempt(attempt(owner.id)));
    await dispatchSynthesisAttempt(permits[0]);
    const yesterday = new Date(Date.now() - 86_400_000);
    await db.update(synthesisAuthorization).set({ authorizedAt: yesterday, dispatchBy: yesterday, executionDeadline: yesterday }).where(eq(synthesisAuthorization.clientId, owner.id));
    const live = await reserveSynthesisAttempt(attempt(owner.id, { maxDurationMs: 60_000 }));
    await dispatchSynthesisAttempt(live);
    const completed = await reserveSynthesisAttempt(attempt(owner.id));
    await dispatchSynthesisAttempt(completed); await finishSynthesisAttempt(completed, "succeeded");
    const before = await inspectSynthesisBudget(owner.slug);
    assert.equal(before.usage.expiredUnresolvedAttempts, "0");
    assert.equal(before.backlog.expiredUnresolvedAttempts, "51");
    assert.ok(before.backlog.oldestExpiredAt);
    await setSynthesisBudget(owner.slug, { ...settings, enabled: false }); // Recovery must not depend on an enabled budget.
    const first = await reconcileDueSynthesisAttempts();
    assert.equal(first.failedClients, 0); assert.equal(first.batchFull, true);
    assert.equal((await inspectSynthesisBudget(owner.slug)).backlog.expiredUnresolvedAttempts, "1");
    const concurrent = await Promise.all([reconcileDueSynthesisAttempts(), reconcileDueSynthesisAttempts()]);
    assert.ok(concurrent.every((entry) => entry.failedClients === 0));
    const after = await inspectSynthesisBudget(owner.slug);
    assert.equal(after.backlog.expiredUnresolvedAttempts, "0"); assert.equal(after.backlog.oldestExpiredAt, null);
    assert.equal(after.backlog.unknownAttempts, "1");
    assert.equal(after.usage.authorizedCostMicros, "100"); // Historical reservations are not shifted or refunded.
    const rows = await db.select().from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, owner.id));
    assert.equal(rows.find((row) => row.id === Number(live.id))?.status, "dispatched");
    assert.equal(rows.find((row) => row.id === Number(completed.id))?.status, "succeeded");
    assert.equal(rows.filter((row) => row.status === "cancelled").length, 50);
    const audits = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, owner.id), eq(governanceAudit.action, "reconcile_synthesis")));
    assert.equal(audits.length, 51); assert.equal(new Set(audits.map((entry) => entry.entityId)).size, 51);
    assert.equal((await finishSynthesisAttempt(permits[0], "succeeded")).accepted, false);
    await finishSynthesisAttempt(live, "cancelled");
  });

  await t.test("reconciliation skips busy tenants and rolls back both status and audit on write contention", async () => {
    const busy = await tenant(); const other = await tenant();
    for (const owner of [busy, other]) {
      await setSynthesisBudget(owner.slug, settings);
      await reserveSynthesisAttempt(attempt(owner.id));
      await db.update(synthesisAuthorization).set({ dispatchBy: sql`clock_timestamp() - interval '1 second'` }).where(eq(synthesisAuthorization.clientId, owner.id));
    }
    const barrier = await probe.connect();
    try {
      await barrier.query("begin"); await barrier.query("select pg_advisory_xact_lock(73008, $1)", [busy.id]);
      const run = await reconcileDueSynthesisAttempts();
      assert.ok(run.busyClients >= 1); assert.equal(run.failedClients, 0);
      assert.equal((await inspectSynthesisBudget(busy.slug)).backlog.expiredUnresolvedAttempts, "1");
      assert.equal((await inspectSynthesisBudget(other.slug)).backlog.expiredUnresolvedAttempts, "0");
      await barrier.query("commit");
      await barrier.query("begin"); await barrier.query("lock table governance_audit in access exclusive mode");
      const failed = await reconcileDueSynthesisAttempts();
      assert.ok(failed.failedClients >= 1);
      assert.equal((await inspectSynthesisBudget(busy.slug)).backlog.expiredUnresolvedAttempts, "1");
      await barrier.query("commit");
      const audits = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, busy.id), eq(governanceAudit.action, "reconcile_synthesis")));
      assert.equal(audits.length, 0);
      assert.equal(await reconcileSynthesisAttempts(busy.slug), 1);
      await assert.rejects(reserveSynthesisAttempt(attempt(other.id, { maxCostMicros: 100 })), /daily-limit/);
    } finally { await barrier.query("rollback"); barrier.release(); }
  });

  await t.test("scheduled recovery bounds tenant fan-out and drains the remaining oldest work on later ticks", async () => {
    const owners = [];
    for (let i = 0; i < 21; i++) {
      const owner = await tenant(); owners.push(owner);
      await setSynthesisBudget(owner.slug, settings); await reserveSynthesisAttempt(attempt(owner.id));
      await db.update(synthesisAuthorization).set({ dispatchBy: sql`clock_timestamp() - interval '10 days'` }).where(eq(synthesisAuthorization.clientId, owner.id));
    }
    const first = await reconcileDueSynthesisAttempts();
    assert.equal(first.examinedClients, 20); assert.equal(first.batchFull, true); assert.equal(first.failedClients, 0);
    const backlog = await Promise.all(owners.map(async (owner) => Number((await inspectSynthesisBudget(owner.slug)).backlog.expiredUnresolvedAttempts)));
    assert.equal(backlog.reduce((a, b) => a + b, 0), 1);
    await reconcileDueSynthesisAttempts();
    const remaining = await Promise.all(owners.map(async (owner) => Number((await inspectSynthesisBudget(owner.slug)).backlog.expiredUnresolvedAttempts)));
    assert.equal(remaining.reduce((a, b) => a + b, 0), 0);
  });

  await t.test("real pg-boss registration and job execution perform metadata-only recovery", async () => {
    const { PgBoss } = await import("pg-boss");
    const { startSynthesisMaintenance, SYNTHESIS_MAINTENANCE_QUEUE } = await import("../src/workers/synthesisMaintenance");
    const owner = await tenant(); await setSynthesisBudget(owner.slug, settings);
    await reserveSynthesisAttempt(attempt(owner.id));
    await db.update(synthesisAuthorization).set({ dispatchBy: sql`clock_timestamp() - interval '1 second'` }).where(eq(synthesisAuthorization.clientId, owner.id));
    const errors: unknown[] = [];
    const boss = new PgBoss({ connectionString: process.env.TEST_DATABASE_URL });
    boss.on("error", (error) => errors.push(error));
    try {
      await boss.start(); await startSynthesisMaintenance(boss);
      const schedule = await boss.getSchedule(SYNTHESIS_MAINTENANCE_QUEUE);
      assert.equal(schedule?.cron, "*/5 * * * *"); assert.equal(schedule?.timezone, "UTC");
      const jobId = await boss.send(SYNTHESIS_MAINTENANCE_QUEUE, null); assert.ok(jobId);
      const deadline = Date.now() + 15_000;
      let completed = false;
      while (Date.now() < deadline) {
        const [job] = await boss.findJobs(SYNTHESIS_MAINTENANCE_QUEUE, { id: jobId });
        assert.notEqual(job?.state, "failed");
        if (job?.state === "completed") { completed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(completed, true); assert.deepEqual(errors, []);
      assert.equal((await inspectSynthesisBudget(owner.slug)).backlog.expiredUnresolvedAttempts, "0");
      assert.equal((await inspectSynthesisBudget(owner.slug)).usage.authorizedCostMicros, "50");
    } finally { await boss.stop({ graceful: true, timeout: 5000 }); }
  });
}
