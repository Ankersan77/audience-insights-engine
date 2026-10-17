import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PgBoss } from "pg-boss";
import { tsImport } from "tsx/esm/api";

const modulePromise = tsImport("./canonicalWorkers.ts", import.meta.url) as Promise<
  typeof import("./canonicalWorkers.ts")
>;

test("canonical worker composition starts only canonical workers in deterministic order", async () => {
  const { startCanonicalWorkers } = await modulePromise;
  const boss = {} as PgBoss;
  const registry = {} as NonNullable<Parameters<typeof startCanonicalWorkers>[1]>["registry"];
  const runtime = {} as NonNullable<Parameters<typeof startCanonicalWorkers>[1]>["runtime"];
  const calls: unknown[] = [];

  await startCanonicalWorkers(boss, {
    registry,
    runtime,
    async startAcquisition(receivedBoss, dependencies) {
      calls.push(["acquisition", receivedBoss === boss, dependencies?.registry === registry, dependencies?.runtime === runtime]);
    },
    async startMaintenance(receivedBoss) { calls.push(["maintenance", receivedBoss === boss]); },
    async startSynthesis(receivedBoss) { calls.push(["synthesis", receivedBoss === boss]); },
  });

  assert.deepEqual(calls, [
    ["acquisition", true, true, true],
    ["maintenance", true],
    ["synthesis", true],
  ]);
});

test("canonical worker startup stops after the first failed registration", async () => {
  const { startCanonicalWorkers } = await modulePromise;
  const calls: string[] = [];

  await assert.rejects(startCanonicalWorkers({} as PgBoss, {
    async startAcquisition() { calls.push("acquisition"); },
    async startMaintenance() { calls.push("maintenance"); throw new Error("maintenance-start-failed"); },
    async startSynthesis() { calls.push("synthesis"); },
  }), { message: "maintenance-start-failed" });
  assert.deepEqual(calls, ["acquisition", "maintenance"]);
});

test("canonical composition cannot import legacy or transitional monitoring worker modules", () => {
  const source = readFileSync(new URL("./canonicalWorkers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:runQueue|runLast30Days|draftInsights|canonicalQueue)[^"']*["']/);
});
