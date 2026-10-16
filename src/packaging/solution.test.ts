import assert from "node:assert/strict";
import test from "node:test";
import type { SensingProfile, SolutionProfile } from "../core/contracts.ts";
import { CircuitBreaker, IdempotencyRegistry, retryDelay, shouldRetry } from "../operations/resilience.ts";
import { exportSolutionProfile, importSolutionPackage, importSolutionProfile } from "./solution.ts";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function legacyChecksum(value: unknown): string {
  let hash = 2166136261;
  for (const char of stableJson(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

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

function sensing(clientId: string): SensingProfile {
  return {
    id: `${clientId}-sensing`, clientId, version: 3, themes: ["category"], markets: ["DK"], competitors: ["competitor-a"], products: ["product-a"],
    audiences: ["category-buyers"], occasions: ["renovation"], risks: ["price-pressure"], sourceConnectionIds: ["official-statistics"], cadence: "weekly",
    lookbackDays: 30, materialityThreshold: 0.2, noveltyThreshold: 0.2, confidenceThreshold: 0.7, freshnessDays: 14, expiryDays: 30,
    minimumCorroboration: 1, deduplicationWindowDays: 30, seasonalExpectations: { category: 100 },
    suppressionRules: ["duplicate", "bot-heavy", "manipulation-risk", "low-sample", "stale"], downRankingRules: ["seasonal"],
    destinations: ["owned-product"], humanReviewRequired: true, decisionContexts: ["market-planning"], quietPeriods: [],
  };
}

test("solution configuration exports tenant-neutral data and verifies on import", () => {
  const exported = exportSolutionProfile(profile("client-a"), "2026-10-16T01:00:00.000Z");
  const serialized = JSON.stringify(exported);
  for (const forbidden of ["apiKey", "password", "bearer", "client content"]) assert.equal(serialized.includes(forbidden), false);
  for (const tenantField of ["client-a", "clientId", "createdAt", "sensingProfileId"]) assert.equal(serialized.includes(tenantField), false);
  assert.deepEqual(importSolutionProfile(exported), exported.profile);
  assert.deepEqual(importSolutionProfile(JSON.parse(serialized)), exported.profile);
  assert.throws(() => importSolutionProfile({ ...exported, checksum: "tampered" }), /checksum/);
});

test("a second client uses the same profile contract without a Core code branch", () => {
  const first = exportSolutionProfile(profile("client-a"), "2026-10-16T01:00:00.000Z");
  const second = exportSolutionProfile({ ...profile("client-b"), markets: ["SE"], languages: ["sv"] }, "2026-10-16T01:00:00.000Z");
  assert.equal(first.format, second.format);
  assert.equal(first.formatVersion, second.formatVersion);
  assert.notEqual(first.checksum, second.checksum);
  assert.deepEqual(importSolutionProfile(first), first.profile);
});

test("portable packages carry tenant-neutral sensing policy and require the matching binding", () => {
  const source = sensing("client-a");
  const configured = { ...profile("client-a"), sensingProfileId: source.id, briefingCadences: ["weekly", "monthly", "quarterly"] as const };
  const exported = exportSolutionProfile(configured, "2026-10-16T01:00:00.000Z", source);
  const imported = importSolutionPackage(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(imported.profile.briefingCadences, ["weekly", "monthly", "quarterly"]);
  assert.equal(exported.formatVersion, 3);
  assert.equal(imported.sensingProfile?.lookbackDays, 30);
  assert.deepEqual(imported.sensingProfile?.sourceConnectionIds, ["official-statistics"]);
  assert.equal(JSON.stringify(exported).includes("client-a"), false);
  assert.throws(() => exportSolutionProfile(configured, "2026-10-16T01:00:00.000Z"), /sensing profile is required/i);
});

test("version two packages migrate on import without inventing sensing policy", () => {
  const current = exportSolutionProfile(profile("client-a"), "2026-10-16T01:00:00.000Z");
  const base = { format: current.format, formatVersion: 2 as const, profile: current.profile, exportedAt: current.exportedAt };
  const legacy = { ...base, checksum: legacyChecksum(base) };
  assert.deepEqual(importSolutionPackage(legacy), { profile: current.profile, sensingProfile: undefined });
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
