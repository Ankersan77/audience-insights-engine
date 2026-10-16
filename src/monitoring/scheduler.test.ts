import assert from "node:assert/strict";
import test from "node:test";
import type { SensingProfile } from "../core/contracts.ts";
import { monitoringScheduleKey, planMonitoringAcquisitions } from "./scheduler.ts";

const profile: SensingProfile = {
  id: "profile-1",
  clientId: "client-a",
  version: 1,
  themes: ["category"],
  markets: ["DK"],
  competitors: ["competitor-a"],
  products: ["product-a"],
  audiences: ["audience-a"], occasions: ["occasion-a"], risks: ["risk-a"],
  sourceConnectionIds: ["source-1", "source-2"],
  cadence: "weekly",
  lookbackDays: 30,
  materialityThreshold: 0.2,
  noveltyThreshold: 0.2,
  confidenceThreshold: 0.7,
  freshnessDays: 14,
  expiryDays: 30,
  minimumCorroboration: 2,
  deduplicationWindowDays: 30,
  seasonalExpectations: {}, suppressionRules: ["duplicate", "bot-heavy", "manipulation-risk", "low-sample", "stale"], downRankingRules: ["seasonal"],
  destinations: ["owned-product"], humanReviewRequired: true, decisionContexts: ["market-planning"],
  quietPeriods: [],
};

test("monitoring schedule keys are deterministic per cadence window", () => {
  assert.equal(monitoringScheduleKey(profile, "2026-10-12T01:00:00.000Z"), monitoringScheduleKey(profile, "2026-10-16T23:00:00.000Z"));
  assert.notEqual(monitoringScheduleKey(profile, "2026-10-16T23:00:00.000Z"), monitoringScheduleKey(profile, "2026-10-19T00:00:00.000Z"));
  assert.throws(() => monitoringScheduleKey({ ...profile, cadence: "whenever" }, "2026-10-16T00:00:00.000Z"), /unsupported-monitoring-cadence/);
});

test("scheduler emits one tenant-scoped idempotent acquisition per configured source", () => {
  const jobs = planMonitoringAcquisitions({ profile, now: "2026-10-16T10:00:00.000Z", monitoringRunId: "run-1" });
  assert.equal(jobs.length, 2);
  assert.equal(new Set(jobs.map((job) => job.idempotencyKey)).size, 2);
  assert.ok(jobs.every((job) => job.clientId === profile.clientId));
  assert.ok(jobs.every((job) => JSON.stringify(job).includes("competitor-a")));
  assert.ok(jobs.every((job) => job.request.since === "2026-09-16T10:00:00.000Z"));
  assert.ok(jobs.every((job) => job.request.until === "2026-10-16T10:00:00.000Z"));
  assert.deepEqual(jobs[0].request.filters?.audiences, ["audience-a"]);
  assert.equal(jobs[0].request.filters?.noveltyThreshold, "0.2");
});

