import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const modulePromise = tsImport("./runQueue.ts", import.meta.url) as Promise<
  typeof import("./runQueue.ts")
>;

test("legacy run queue registers on an injected runtime without owning PgBoss startup", async () => {
  const { RUN_QUEUE_NAME, startRunWorker } = await modulePromise;
  const calls: unknown[] = [];
  let handler: unknown;
  const boss = {
    async createQueue(...args: unknown[]) { calls.push(["createQueue", ...args]); },
    async work(name: string, callback: unknown) {
      calls.push(["work", name]);
      handler = callback;
      return "legacy-worker";
    },
  } as unknown as Parameters<typeof startRunWorker>[0];

  await startRunWorker(boss);

  assert.deepEqual(calls, [
    ["createQueue", RUN_QUEUE_NAME, { retryLimit: 0, expireInSeconds: 660 }],
    ["work", RUN_QUEUE_NAME],
  ]);
  assert.equal(typeof handler, "function");
  const source = readFileSync(new URL("./runQueue.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new\s+PgBoss|\.start\s*\(/);
});
