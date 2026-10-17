import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const modulePromise = tsImport("./canonicalQueue.ts", import.meta.url) as Promise<
  typeof import("./canonicalQueue.ts")
>;

async function harness(overrides: Partial<NonNullable<Parameters<(typeof import("./canonicalQueue.ts"))["startMonitoringScheduler"]>[1]>> = {}) {
  const { MONITORING_SCHEDULER_QUEUE, startMonitoringScheduler } = await modulePromise;
  const registrations: unknown[] = [];
  const calls: string[] = [];
  const logs: unknown[] = [];
  let handler: () => Promise<unknown> = async () => {
    throw new Error("handler-not-registered");
  };
  const boss = {
    async createQueue(...args: unknown[]) { registrations.push(["createQueue", ...args]); },
    async schedule(...args: unknown[]) { registrations.push(["schedule", ...args]); },
    async work(name: string, callback: typeof handler) {
      registrations.push(["work", name]);
      handler = callback;
      return "monitoring-worker";
    },
  } as unknown as Parameters<typeof startMonitoringScheduler>[0];
  const dependencies: NonNullable<Parameters<typeof startMonitoringScheduler>[1]> = {
    async enqueueDueRuns() {
      calls.push("enqueue-due-runs");
      return { scheduled: 1, alreadyScheduled: 2, failedConfiguration: 3 };
    },
    async reconcileRuns() { calls.push("reconcile-runs"); return 4; },
    async qualifyRuns() { calls.push("qualify-runs"); return 5; },
    async generateBriefings() {
      calls.push("generate-briefings");
      return { created: 6, invalidProfiles: 7 };
    },
    log(event, fields) { logs.push([event, fields]); },
    ...overrides,
  };

  await startMonitoringScheduler(boss, dependencies);
  return { calls, handler, logs, queue: MONITORING_SCHEDULER_QUEUE, registrations };
}

test("transitional monitoring scheduler retains its queue contract and monitoring-only execution", async () => {
  const run = await harness();

  assert.deepEqual(run.registrations, [
    ["createQueue", run.queue, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 300 }],
    ["schedule", run.queue, "*/15 * * * *", null, { tz: "UTC" }],
    ["work", run.queue],
  ]);
  assert.deepEqual(await run.handler(), {
    scheduled: 1,
    alreadyScheduled: 2,
    failedConfiguration: 3,
    reconciled: 4,
    qualified: 5,
    briefings: { created: 6, invalidProfiles: 7 },
  });
  assert.deepEqual(run.calls, ["enqueue-due-runs", "reconcile-runs", "qualify-runs", "generate-briefings"]);
  assert.deepEqual(run.logs, [["monitoring-scheduler", {
    scheduled: 1,
    alreadyScheduled: 2,
    failedConfiguration: 3,
    reconciled: 4,
    qualified: 5,
    briefings: { created: 6, invalidProfiles: 7 },
  }]]);
});

test("monitoring failure is bounded and cannot expose dependency details", async () => {
  const run = await harness({
    async reconcileRuns() { throw new Error("secret monitoring row"); },
  });

  await assert.rejects(run.handler(), { message: "monitoring-scheduler-unavailable" });
  assert.deepEqual(run.logs, [["monitoring-scheduler-failed", {
    errorCode: "monitoring-maintenance-unavailable",
  }]]);
  assert.doesNotMatch(JSON.stringify(run.logs), /secret monitoring row/);
});

test("monitoring scheduler cannot regain canonical maintenance dependencies", () => {
  const source = readFileSync(new URL("./canonicalQueue.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:auth_sessions|queries\/retention|acquisitionQueue|canonicalMaintenance)[^"']*["']/);
});
