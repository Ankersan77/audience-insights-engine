import assert from "node:assert/strict";
import test from "node:test";
import type { SolutionProfile } from "../core/contracts.ts";
import { CircuitBreaker, IdempotencyRegistry, retryDelay, shouldRetry } from "../operations/resilience.ts";
import { exportSolutionProfile, importSolutionProfile } from "./solution.ts";

function profile(clientId: string): SolutionProfile {
  return {
    id: `${clientId}-profile`,
    clientId,
    version: 1,
    status: "active",
    enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }],
    providerBindings: { documents: "source-connection-documents" },
    markets: ["DK"],
    languages: ["da"],
    reviewRoles: { learning: ["reviewer"] },
    retention: { evidenceDays: 180, rawHours: 24, auditDays: 365 },
    createdAt: "2026-10-16T00:00:00.000Z",
  };
}

test("solution configuration exports without credentials or client content and verifies on import", () => {
  const exported = exportSolutionProfile(profile("client-a"), "2026-10-16T01:00:00.000Z");
  const serialized = JSON.stringify(exported);
  for (const forbidden of ["apiKey", "password", "bearer", "client content"]) assert.equal(serialized.includes(forbidden), false);
  assert.deepEqual(importSolutionProfile(exported, "client-a"), profile("client-a"));
  assert.throws(() => importSolutionProfile(exported, "client-b"), /client-mismatch/);
  assert.throws(() => importSolutionProfile({ ...exported, checksum: "tampered" }, "client-a"), /checksum/);
});

test("a second client uses the same profile contract without a Core code branch", () => {
  const first = exportSolutionProfile(profile("client-a"), "2026-10-16T01:00:00.000Z");
  const second = exportSolutionProfile({ ...profile("client-b"), markets: ["SE"], languages: ["sv"] }, "2026-10-16T01:00:00.000Z");
  assert.equal(first.format, second.format);
  assert.equal(first.formatVersion, second.formatVersion);
  assert.notEqual(first.checksum, second.checksum);
});

test("retry is bounded, classified, and exponentially backed off", () => {
  const policy = { maximumAttempts: 3, baseDelayMs: 100, maximumDelayMs: 500, retryableCodes: ["rate-limit", "transient"] };
  assert.equal(shouldRetry(policy, 1, "transient"), true);
  assert.equal(shouldRetry(policy, 3, "transient"), false);
  assert.equal(shouldRetry(policy, 1, "permission"), false);
  assert.deepEqual([retryDelay(policy, 1), retryDelay(policy, 2), retryDelay(policy, 3), retryDelay(policy, 4)], [100, 200, 400, 500]);
});

test("idempotency prevents duplicate external work", async () => {
  const registry = new IdempotencyRegistry<{ count: number }>();
  let calls = 0;
  const first = await registry.execute("key", async () => ({ count: ++calls }));
  const second = await registry.execute("key", async () => ({ count: ++calls }));
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(calls, 1);
});

test("circuit breaker opens and recovers after the configured interval", () => {
  const breaker = new CircuitBreaker(2, 1000);
  breaker.failure(0);
  assert.equal(breaker.state, "closed");
  breaker.failure(10);
  assert.equal(breaker.state, "open");
  assert.equal(breaker.canRun(500), false);
  assert.equal(breaker.canRun(1010), true);
  assert.equal(breaker.state, "closed");
});
