import assert from "node:assert/strict";
import test from "node:test";
import type { SensingProfile } from "../core/contracts.ts";
import { buildQuantitativeSignalCandidates, type MonitoringObservation } from "./candidates.ts";
import { briefingCadence, qualifySignals } from "./engine.ts";

const profile: SensingProfile = {
  id: "sense-1",
  clientId: "client-a",
  version: 1,
  themes: ["competitor-price", "audience-barrier"],
  markets: ["DK"],
  competitors: ["Competitor A"],
  products: ["Product A"],
  sourceConnectionIds: ["source-1", "source-2"],
  cadence: "weekly",
  materialityThreshold: 0.2,
  confidenceThreshold: 0.7,
  freshnessDays: 14,
  minimumCorroboration: 2,
  quietPeriods: [],
};

test("monitoring preserves an explicit no-change outcome", () => {
  const result = qualifySignals({
    profile,
    now: "2026-10-16T00:00:00.000Z",
    sourceHealthOk: true,
    candidates: [{
      id: "s1", clientId: "client-a", theme: "competitor-price", currentValue: 101, baselineValue: 100,
      confidence: 0.9, observedAt: "2026-10-15T00:00:00.000Z", sourceIds: ["source-1", "source-2"],
      botRisk: 0, manipulationRisk: 0, sampleSize: 100,
    }],
  });
  assert.equal(result.outcome, "no_material_change");
  assert.ok(result.qualifications[0].reasons.includes("below-materiality"));
});

test("duplicate, bot-heavy, stale, low-sample and cross-client signals fail qualification", () => {
  const result = qualifySignals({
    profile,
    now: "2026-10-16T00:00:00.000Z",
    sourceHealthOk: true,
    candidates: [{
      id: "s1", clientId: "client-b", theme: "competitor-price", currentValue: 150, baselineValue: 100,
      confidence: 0.9, observedAt: "2020-01-01T00:00:00.000Z", sourceIds: ["source-1"], duplicateOf: "old",
      botRisk: 0.9, manipulationRisk: 0.8, sampleSize: 2,
    }],
  });
  const reasons = result.qualifications[0].reasons;
  for (const expected of ["different-client", "duplicate", "insufficient-corroboration", "bot-heavy", "manipulation-risk", "low-sample", "stale"]) {
    assert.ok(reasons.includes(expected));
  }
});

test("qualified signals produce owned-surface review work without automatic action", () => {
  const result = qualifySignals({
    profile,
    now: "2026-10-16T00:00:00.000Z",
    sourceHealthOk: true,
    candidates: [{
      id: "s1", clientId: "client-a", theme: "competitor-price", currentValue: 150, baselineValue: 100,
      confidence: 0.9, observedAt: "2026-10-15T00:00:00.000Z", sourceIds: ["source-1", "source-2"],
      botRisk: 0.1, manipulationRisk: 0.1, sampleSize: 100,
    }],
  });
  assert.equal(result.outcome, "signals_qualified");
  assert.match(result.message, /human review/);
  assert.match(result.message, /no learning or external action/i);
});

test("source-health failure is distinct from no change", () => {
  const result = qualifySignals({ profile, now: "2026-10-16T00:00:00.000Z", sourceHealthOk: false, candidates: [] });
  assert.equal(result.outcome, "source_health_failure");
});

test("missing history is needs-context and never a silent no-change", () => {
  const result = qualifySignals({
    profile,
    now: "2026-10-16T00:00:00.000Z",
    sourceHealthOk: true,
    candidates: [{
      id: "new-series", clientId: "client-a", theme: "competitor-price", currentValue: 150,
      confidence: 0.9, observedAt: "2026-10-15T00:00:00.000Z", sourceIds: ["source-1", "source-2"],
      botRisk: 0, manipulationRisk: 0, sampleSize: 100,
    }],
  });
  assert.equal(result.outcome, "needs_context");
  assert.ok(result.qualifications[0].reasons.includes("missing-baseline"));
});

test("a zero baseline is non-comparable without an absolute materiality policy", () => {
  const result = qualifySignals({
    profile,
    now: "2026-10-16T00:00:00.000Z",
    sourceHealthOk: true,
    candidates: [{
      id: "zero-series", clientId: "client-a", theme: "competitor-price", currentValue: 1, baselineValue: 0,
      confidence: 0.9, observedAt: "2026-10-15T00:00:00.000Z", sourceIds: ["source-1", "source-2"],
      botRisk: 0, manipulationRisk: 0, sampleSize: 100,
    }],
  });
  assert.equal(result.outcome, "needs_context");
  assert.ok(result.qualifications[0].reasons.includes("non-comparable-baseline"));
});

test("quantitative candidates use one latest baseline per source and preserve lineage", () => {
  const observation = (overrides: Partial<MonitoringObservation>): MonitoringObservation => ({
    evidenceId: "e1", clientId: "client-a", sourceConnectionId: "source-1", sourceClass: "first_party_aggregate",
    metricKey: "price_index", value: 100, unit: "index", observedAt: "2026-10-01T00:00:00.000Z",
    dimensions: { theme: "competitor-price" }, cohortSize: 50, confidence: 0.8,
    applicability: { markets: ["DK"], languages: ["da"], categories: ["food"], audiences: [], campaigns: [] },
    suppressed: false, ...overrides,
  });
  const candidates = buildQuantitativeSignalCandidates({
    clientId: "client-a",
    current: [
      observation({ evidenceId: "e3", value: 150, observedAt: "2026-10-15T00:00:00.000Z" }),
      observation({ evidenceId: "e4", sourceConnectionId: "source-2", value: 140, observedAt: "2026-10-15T00:00:00.000Z" }),
      observation({ evidenceId: "other", clientId: "client-b", value: 999 }),
    ],
    history: [
      observation({ evidenceId: "old", value: 80, observedAt: "2026-09-01T00:00:00.000Z" }),
      observation({ evidenceId: "latest-1", value: 100, observedAt: "2026-10-08T00:00:00.000Z" }),
      observation({ evidenceId: "latest-2", sourceConnectionId: "source-2", value: 100, observedAt: "2026-10-08T00:00:00.000Z" }),
    ],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].currentValue, 145);
  assert.equal(candidates[0].baselineValue, 100);
  assert.deepEqual(candidates[0].sourceIds, ["source-1", "source-2"]);
  assert.deepEqual(candidates[0].evidenceIds, ["e3", "e4"]);
  assert.equal(candidates[0].sampleSize, 100);
});

test("public-conversation metrics fail closed without explicit risk metadata", () => {
  const candidates = buildQuantitativeSignalCandidates({
    clientId: "client-a",
    current: [{
      evidenceId: "public-now", clientId: "client-a", sourceConnectionId: "source-1", sourceClass: "public_conversation",
      metricKey: "theme_share", value: 30, unit: "%", observedAt: "2026-10-15T00:00:00.000Z",
      dimensions: { theme: "audience-barrier" }, cohortSize: 100, confidence: 0.9,
      applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] }, suppressed: false,
    }],
    history: [{
      evidenceId: "public-before", clientId: "client-a", sourceConnectionId: "source-1", sourceClass: "public_conversation",
      metricKey: "theme_share", value: 20, unit: "%", observedAt: "2026-10-01T00:00:00.000Z",
      dimensions: { theme: "audience-barrier" }, cohortSize: 100, confidence: 0.9,
      applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] }, suppressed: false,
    }],
  });
  assert.equal(candidates[0].botRisk, 1);
  assert.equal(candidates[0].manipulationRisk, 1);
});

test("briefing contracts cover weekly, monthly and quarterly review", () => {
  assert.match(briefingCadence("weekly").scope, /market/i);
  assert.match(briefingCadence("monthly").scope, /campaign/i);
  assert.match(briefingCadence("quarterly").scope, /Market Twin/i);
});
