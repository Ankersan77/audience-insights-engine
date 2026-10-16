import assert from "node:assert/strict";
import test from "node:test";
import { startSynthesisMaintenance, SYNTHESIS_MAINTENANCE_QUEUE } from "./synthesisMaintenance.ts";

async function harness(reconcile: NonNullable<Parameters<typeof startSynthesisMaintenance>[1]>["reconcile"]) {
  const registered: unknown[] = []; const logs: unknown[] = [];
  let handler: () => Promise<unknown> = async () => { throw new Error("not-registered"); };
  const boss = {
    async createQueue(...args: unknown[]) { registered.push(["createQueue", ...args]); },
    async schedule(...args: unknown[]) { registered.push(["schedule", ...args]); },
    async work(name: string, callback: typeof handler) { registered.push(["work", name]); handler = callback; return "test-worker"; },
  } as unknown as Parameters<typeof startSynthesisMaintenance>[0];
  await startSynthesisMaintenance(boss, { reconcile, log: (event, fields) => { logs.push({ event, ...fields }); } });
  return { registered, logs, invoke: () => handler() };
}
const result = { examinedClients: 2, reconciledAttempts: 3, busyClients: 0, failedClients: 0, batchFull: false };

test("synthesis recovery has its own durable UTC schedule, bounded retries and no input payload", async () => {
  let calls = 0;
  const run = await harness(async () => { calls++; return result; });
  assert.deepEqual(run.registered, [
    ["createQueue", SYNTHESIS_MAINTENANCE_QUEUE, { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 300 }],
    ["schedule", SYNTHESIS_MAINTENANCE_QUEUE, "*/5 * * * *", null, { tz: "UTC" }],
    ["work", SYNTHESIS_MAINTENANCE_QUEUE],
  ]);
  assert.equal(calls, 0);
  assert.deepEqual(await run.invoke(), result);
  assert.deepEqual(run.logs, [{ event: "synthesis-maintenance", ...result }]);
});

test("recovery failure is redacted before durable queue errors and partial failures request retry", async () => {
  const unavailable = await harness(async () => { throw new Error("secret database URL and private SQL"); });
  await assert.rejects(unavailable.invoke(), { message: "synthesis-maintenance-unavailable" });
  assert.deepEqual(unavailable.logs, [{ event: "synthesis-maintenance-failed", errorCode: "reconciliation-unavailable" }]);
  const partial = await harness(async () => ({ ...result, failedClients: 1 }));
  await assert.rejects(partial.invoke(), { message: "synthesis-maintenance-incomplete" });
  assert.deepEqual(partial.logs, [{ event: "synthesis-maintenance", ...result, failedClients: 1 }]);
});

test("busy clients and full batches defer to the next cadence without external replay", async () => {
  const deferred = { ...result, busyClients: 1, batchFull: true };
  const run = await harness(async () => deferred);
  assert.deepEqual(await run.invoke(), deferred);
});
