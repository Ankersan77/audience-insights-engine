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
    async purgeSessions() { calls.push("purge-sessions"); return 7; },
    async enforceRetention() { calls.push("enforce-retention"); return retention; },
    async reconcileAcquisitions() { calls.push("reconcile-acquisitions"); return 8; },
    async dispatchAcquisitions(received) {
      calls.push(["dispatch-acquisitions", received === boss]);
      return 9;
    },
    log(event, fields) { logs.push([event, fields]); },
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
  });
  assert.deepEqual(run.calls, [
    "purge-sessions",
    "enforce-retention",
    "reconcile-acquisitions",
    ["dispatch-acquisitions", true],
  ]);
  assert.deepEqual(run.logs, [["canonical-maintenance", {
    expiredSessionsRemoved: 7,
    retention,
    staleAcquisitions: 8,
    dispatched: 9,
  }]]);
});

test("canonical maintenance isolates stages, redacts stable failure codes and then asks pg-boss to retry", async () => {
  const run = await harness({
    async enforceRetention() { throw new Error("secret database URL and private SQL"); },
  });

  await assert.rejects(run.handler(), { message: "canonical-maintenance-incomplete" });
  assert.deepEqual(run.calls, [
    "purge-sessions",
    "reconcile-acquisitions",
    ["dispatch-acquisitions", true],
  ]);
  assert.deepEqual(run.logs, [
    ["canonical-maintenance", {
      expiredSessionsRemoved: 7,
      retention: null,
      staleAcquisitions: 8,
      dispatched: 9,
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
  assert.deepEqual(run.calls, ["enforce-retention", ["dispatch-acquisitions", true]]);
  assert.deepEqual(run.logs, [
    ["canonical-maintenance", {
      expiredSessionsRemoved: null,
      retention,
      staleAcquisitions: null,
      dispatched: 9,
    }],
    ["canonical-maintenance-failed", {
      errorCodes: ["session-cleanup-failed", "acquisition-reconciliation-failed"],
    }],
  ]);
  assert.doesNotMatch(JSON.stringify(run.logs), /private/);
});

test("canonical maintenance has no monitoring or briefing dependency", () => {
  const source = readFileSync(new URL("./canonicalMaintenance.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:queries\/monitoring|queries\/briefings|canonicalQueue)[^"']*["']/);
});
