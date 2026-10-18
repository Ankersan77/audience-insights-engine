import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { validateRemovedRuntime } from "./removed-runtime-guard.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "removed-runtime-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, contents] of [
    ["src/workers/index.ts", "startCanonicalWorkers();"],
    ["Dockerfile", "FROM node:24-alpine"],
    [".github/workflows/ci.yml", "name: CI"],
    [".env.example", "DATABASE_URL="],
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

for (const [name, path, contents, expected] of [
  ["removed path", "src/workers/runQueue.ts", "", "Removed legacy surface"],
  ["worker registration", "src/workers/index.ts", "startRunWorker();", "removed marker"],
  ["Python image", "Dockerfile", "RUN apk add python3", "must not install Python"],
  ["submodule checkout", ".github/workflows/ci.yml", "submodules: true", "must not fetch"],
  ["legacy environment", ".env.example", "ENABLE_LEGACY_LAST30DAYS=false", "advertises removed"],
  ["direct provider", "src/provider.ts", "process.env.ANTHROPIC_API_KEY", "removed provider marker"],
  ["renamed runtime reference", "src/new-worker.ts", "startLast30DaysAgain();", "removed last30days marker"],
  ["application route reference", "app/api/reintroduced/route.ts", "startLast30DaysAgain();", "removed last30days marker"],
  ["script provider reference", "scripts/reintroduced-provider.ts", "process.env.XAI_API_KEY", "removed provider marker"],
] as const) {
  test(`removed-runtime guard rejects ${name}`, (t) => {
    const root = fixture(t);
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
    assert.ok(validateRemovedRuntime(root).some((failure) => failure.includes(expected)));
  });
}
