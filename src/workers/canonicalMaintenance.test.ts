import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const modulePromise = tsImport("./canonicalMaintenance.ts", import.meta.url) as Promise<
  typeof import("./canonicalMaintenance.ts")
>;

const retention = {
  evidenceExpired: 1,
  collectionsExpired: 2,
  observationsRemoved: 3,
  themesRemoved: 4,
  artifactCitationsRedacted: 5,
  intelligenceDecayed: 6,
  batchFull: false,
};

async function harness(overrides: Partial<NonNullable<Parameters<(typeof import("./canonicalMaintenance.ts"))["startCanonicalMaintenance"]>[1]>> = {}) {
  const { CANONICAL_MAINTENANCE_QUEUE, startCanonicalMaintenance } = await modulePromise;
  const registrations: unknown[] = [];
  const calls: unknown[] = [];
  const logs: unknown[] = [];
  let handler: () => Promise<unknown> = async () => {
    throw new Error("handler-not-registered");
  };
  const boss = {
    async createQueue(...args: unknown[]) { registrations.push(["createQueue", ...args]); },
    async schedule(...args: unknown[]) { registrations.push(["schedule", ...args]); },
    async unschedule(...args: unknown[]) { registrations.push(["unschedule", ...args]); },
    async work(name: string, callback: typeof handler) {
      registrations.push(["work", name]);
      handler = callback;
      return "maintenance-worker";
    },
    async send() { throw new Error("manual-startup-send-forbidden"); },
  } as unknown as Parameters<typeof startCanonicalMaintenance>[0];
  const dependencies: NonNullable<Parameters<typeof startCanonicalMaintenance>[1]> = {
    async purgeSessions(_now, options) { calls.push(["purge-sessions", options.deadline.getTime()]); return { removed: 7, batchFull: false }; },
    async enforceRetention(_now, options) { calls.push(["enforce-retention", options.deadline.getTime()]); return retention; },
    async reconcileAcquisitions(_now, options) { calls.push(["reconcile-acquisitions", options.deadline.getTime()]); return { processed: 8, batchFull: false }; },
    async dispatchAcquisitions(received, options) {
      calls.push(["dispatch-acquisitions", received === boss, options.deadline.getTime()]);
      return { attempted: 10, dispatched: 9, batchFull: false };
    },
    log(event, fields) { logs.push([event, fields]); },
    clock: () => 1_000,
    ...overrides,
  };

  await startCanonicalMaintenance(boss, dependencies);
  return { boss, calls, handler, logs, queue: CANONICAL_MAINTENANCE_QUEUE, registrations };
}

test("canonical maintenance registers one durable schedule with bounded catch-up", async () => {
  const run = await harness();

  assert.deepEqual(run.registrations, [
    ["createQueue", run.queue, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 300 }],
    ["schedule", run.queue, "*/15 * * * *", null, { tz: "UTC", missed: "once" }],
    ["work", run.queue],
  ]);
  assert.deepEqual(run.calls, []);
});

test("maintenance kill switch removes only its schedule and remains disabled after startup", async () => {
  const run = await harness({ disabled: true });

  assert.deepEqual(run.registrations, [["unschedule", run.queue]]);
  assert.deepEqual(run.calls, []);
  assert.deepEqual(run.logs, [["canonical-maintenance-disabled", { scheduleRemoved: true }]]);
});

test("canonical maintenance executes only hygiene and acquisition recovery in order", async () => {
  const run = await harness();

  assert.deepEqual(await run.handler(), {
    expiredSessionsRemoved: 7,
    retention,
    staleAcquisitions: 8,
    dispatched: 9,
    progress: {
      sessions: { removed: 7, batchFull: false },
      acquisitionReconciliation: { processed: 8, batchFull: false },
      acquisitionDispatch: { attempted: 10, dispatched: 9, batchFull: false },
      batchFull: false,
      elapsedMs: 0,
      deferredStages: [],
    },
  });
  assert.deepEqual(run.calls, [
    ["purge-sessions", 31_000],
    ["enforce-retention", 181_000],
    ["reconcile-acquisitions", 211_000],
    ["dispatch-acquisitions", true, 241_000],
  ]);
  assert.deepEqual(run.logs, [["canonical-maintenance", {
    expiredSessionsRemoved: 7,
    retention,
    staleAcquisitions: 8,
    dispatched: 9,
    progress: {
      sessions: { removed: 7, batchFull: false },
      acquisitionReconciliation: { processed: 8, batchFull: false },
      acquisitionDispatch: { attempted: 10, dispatched: 9, batchFull: false },
      batchFull: false,
      elapsedMs: 0,
      deferredStages: [],
    },
  }]]);
});

test("canonical maintenance isolates stages, redacts stable failure codes and then asks pg-boss to retry", async () => {
  const run = await harness({
    async enforceRetention() { throw new Error("secret database URL and private SQL"); },
  });

  await assert.rejects(run.handler(), { message: "canonical-maintenance-incomplete" });
  assert.deepEqual(run.calls, [
    ["purge-sessions", 31_000],
    ["reconcile-acquisitions", 211_000],
    ["dispatch-acquisitions", true, 241_000],
  ]);
  assert.deepEqual(run.logs, [
    ["canonical-maintenance", {
      expiredSessionsRemoved: 7,
      retention: null,
      staleAcquisitions: 8,
      dispatched: 9,
      progress: {
        sessions: { removed: 7, batchFull: false },
        acquisitionReconciliation: { processed: 8, batchFull: false },
        acquisitionDispatch: { attempted: 10, dispatched: 9, batchFull: false },
        batchFull: false,
        elapsedMs: 0,
        deferredStages: [],
      },
    }],
    ["canonical-maintenance-failed", { errorCodes: ["retention-failed"] }],
  ]);
  assert.doesNotMatch(JSON.stringify(run.logs), /secret|private SQL/);
});

test("canonical maintenance reports multiple stage failures in stable execution order", async () => {
  const run = await harness({
    async purgeSessions() { throw new Error("private session error"); },
    async reconcileAcquisitions() { throw new Error("private acquisition error"); },
  });

  await assert.rejects(run.handler(), { message: "canonical-maintenance-incomplete" });
  assert.deepEqual(run.calls, [["enforce-retention", 181_000], ["dispatch-acquisitions", true, 241_000]]);
  assert.deepEqual(run.logs, [
    ["canonical-maintenance", {
      expiredSessionsRemoved: null,
      retention,
      staleAcquisitions: null,
      dispatched: 9,
      progress: {
        sessions: null,
        acquisitionReconciliation: null,
        acquisitionDispatch: { attempted: 10, dispatched: 9, batchFull: false },
        batchFull: false,
        elapsedMs: 0,
        deferredStages: [],
      },
    }],
    ["canonical-maintenance-failed", {
      errorCodes: ["session-cleanup-failed", "acquisition-reconciliation-failed"],
    }],
  ]);
  assert.doesNotMatch(JSON.stringify(run.logs), /private/);
});

test("bounded backlog is successful continuation and keeps compatibility counters", async () => {
  const run = await harness({
    async purgeSessions() { return { removed: 500, batchFull: true }; },
    async reconcileAcquisitions() { return { processed: 100, batchFull: true }; },
    async dispatchAcquisitions() { return { attempted: 100, dispatched: 99, batchFull: true }; },
  });

  const result = await run.handler() as {
    expiredSessionsRemoved: number | null;
    staleAcquisitions: number | null;
    dispatched: number | null;
    progress: { batchFull: boolean };
  };
  assert.equal(result.expiredSessionsRemoved, 500);
  assert.equal(result.staleAcquisitions, 100);
  assert.equal(result.dispatched, 99);
  assert.equal(result.progress.batchFull, true);
  assert.equal(run.logs.some((entry) => (entry as unknown[])[0] === "canonical-maintenance-failed"), false);
});

test("wrapped database timeouts are successful continuation rather than job failures", async () => {
  const wrapped = new Error("query failed", { cause: Object.assign(new Error("cancelled"), { code: "57014" }) });
  const run = await harness({
    async purgeSessions() { throw wrapped; },
    async reconcileAcquisitions() { throw new Error("outer", { cause: Object.assign(new Error("locked"), { code: "55P03" }) }); },
  });

  const result = await run.handler() as { progress: { deferredStages: string[]; batchFull: boolean } };
  assert.deepEqual(result.progress.deferredStages, ["sessions", "acquisitionReconciliation"]);
  assert.equal(result.progress.batchFull, true);
  assert.equal(run.logs.some((entry) => (entry as unknown[])[0] === "canonical-maintenance-failed"), false);
});

test("stage deadlines are fixed slices and an exhausted slice defers without logging content", async () => {
  let time = 1_000;
  const run = await harness({
    clock: () => time,
    async purgeSessions() { time = 181_000; return { removed: 1, batchFull: false }; },
  });

  const result = await run.handler() as { progress: { batchFull: boolean; deferredStages: string[]; elapsedMs: number } };
  assert.deepEqual(result.progress.deferredStages, ["retention"]);
  assert.equal(result.progress.batchFull, true);
  assert.equal(result.progress.elapsedMs, 180_000);
  assert.doesNotMatch(JSON.stringify(run.logs), /tenant|payload|source content/i);
});

test("the outer deadline releases a hung stage, observes late rejection and preserves later stages", async () => {
  const startedAt = Date.now() - 29_995;
  let firstClockRead = true;
  const run = await harness({
    clock: () => {
      if (firstClockRead) {
        firstClockRead = false;
        return startedAt;
      }
      return Date.now();
    },
    async purgeSessions() { return new Promise<never>(() => undefined); },
  });

  const result = await run.handler() as { progress: { deferredStages: string[]; batchFull: boolean } };
  assert.deepEqual(result.progress.deferredStages, ["sessions"]);
  assert.equal(result.progress.batchFull, true);
  assert.ok(run.calls.some((entry) => Array.isArray(entry) && entry[0] === "enforce-retention"));
  assert.ok(run.calls.some((entry) => Array.isArray(entry) && entry[0] === "reconcile-acquisitions"));
  assert.ok(run.calls.some((entry) => Array.isArray(entry) && entry[0] === "dispatch-acquisitions"));
  assert.equal(run.logs.some((entry) => (entry as unknown[])[0] === "canonical-maintenance-failed"), false);
});

test("canonical maintenance has no monitoring or briefing dependency", () => {
  const source = readFileSync(new URL("./canonicalMaintenance.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:queries\/monitoring|queries\/briefings|canonicalQueue)[^"']*["']/);
});
