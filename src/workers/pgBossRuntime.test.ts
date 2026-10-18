import assert from "node:assert/strict";
import test from "node:test";
import type { PgBoss } from "pg-boss";
import { createWorkerRuntimeManager, installWorkerShutdown, runWorkerStartup, WORKER_DATABASE_OPTIONS } from "./pgBossRuntime.ts";

test("neutral runtime starts once concurrently and wires bounded errors before start", async () => {
  const calls: unknown[] = [];
  let errorHandler: (() => void) | undefined;
  const fake = {
    on(event: string, handler: () => void) { calls.push(["on", event]); errorHandler = handler; return fake; },
    async start() { calls.push(["start"]); },
  } as unknown as PgBoss;
  const errors: string[] = [];
  const manager = createWorkerRuntimeManager({
    connectionString: "postgres://runtime-test",
    createBoss(connectionString, databaseOptions) { calls.push(["create", connectionString, databaseOptions]); return fake; },
    onRuntimeError(code) { errors.push(code); },
  });

  const [first, second] = await Promise.all([manager.get(), manager.get()]);
  errorHandler?.();

  assert.equal(first, fake);
  assert.equal(second, fake);
  assert.deepEqual(calls, [["create", "postgres://runtime-test", WORKER_DATABASE_OPTIONS], ["on", "error"], ["start"]]);
  assert.deepEqual(errors, ["pg-boss-runtime-error"]);
});

test("failed startup is not cached", async () => {
  let attempts = 0;
  let cleanupAttempts = 0;
  const manager = createWorkerRuntimeManager({ createBoss() {
    attempts += 1;
    return {
      on() { return this; },
      async start() { if (attempts === 1) throw new Error("secret connection detail"); },
      async stop() { cleanupAttempts += 1; },
    } as unknown as PgBoss;
  } });
  await assert.rejects(manager.get());
  await manager.get();
  assert.equal(attempts, 2);
  assert.equal(cleanupAttempts, 1);
});

test("shutdown drains once, redacts stop failures and preserves exit-zero semantics", async () => {
  const signals = new Map<string, () => void>();
  const calls: unknown[] = [];
  const logs: unknown[] = [];
  const shutdown = installWorkerShutdown({
    async stop(options: unknown) { calls.push(options); throw new Error("secret stop detail"); },
  } as Pick<PgBoss, "stop">, {
    timeoutMs: 1234,
    registerSignal(signal, handler) { signals.set(signal, handler); },
    exit(code) { calls.push(["exit", code]); },
    log(event, fields) { logs.push([event, fields]); },
  });

  await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

  assert.deepEqual(calls, [{ graceful: true, timeout: 1234 }, ["exit", 0]]);
  assert.deepEqual(logs, [
    ["shutdown-started", { signal: "SIGTERM" }],
    ["shutdown-failed", { signal: "SIGTERM", errorCode: "pg-boss-stop-failed" }],
  ]);
  assert.deepEqual([...signals.keys()], ["SIGTERM", "SIGINT"]);
});

test("startup failure drains once and exits non-zero", async () => {
  const calls: unknown[] = [];
  const shutdown = installWorkerShutdown({
    async stop(options: unknown) { calls.push(["stop", options]); },
  } as Pick<PgBoss, "stop">, {
    registerSignal() { /* exercised by the signal-specific test above */ },
    exit(code) { calls.push(["exit", code]); },
    log(event, fields) { calls.push(["log", event, fields]); },
  });

  await Promise.all([shutdown("STARTUP_FAILURE"), shutdown("SIGTERM")]);

  assert.deepEqual(calls, [
    ["log", "shutdown-started", { signal: "STARTUP_FAILURE" }],
    ["stop", { graceful: true, timeout: 5 * 60 * 1000 }],
    ["log", "shutdown-drained", { signal: "STARTUP_FAILURE" }],
    ["exit", 1],
  ]);
});

test("registration failure stops later registrations and invokes one startup drain", async () => {
  const calls: string[] = [];
  const started = await runWorkerStartup([
    async () => { calls.push("deployment-retirement-complete"); },
    async () => { calls.push("canonical-started"); throw new Error("private startup detail"); },
    async () => { calls.push("monitoring-must-not-start"); },
  ], async (reason) => { calls.push(`shutdown:${reason}`); }, () => { calls.push("bounded-fatal-log"); });

  assert.equal(started, false);
  assert.deepEqual(calls, ["deployment-retirement-complete", "canonical-started", "bounded-fatal-log", "shutdown:STARTUP_FAILURE"]);
  assert.doesNotMatch(JSON.stringify(calls), /private startup detail/);
});
