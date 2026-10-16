import assert from "node:assert/strict";
import test from "node:test";
import type { SensingProfile } from "../core/contracts.ts";
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

test("briefing contracts cover weekly, monthly and quarterly review", () => {
  assert.match(briefingCadence("weekly").scope, /market/i);
  assert.match(briefingCadence("monthly").scope, /campaign/i);
  assert.match(briefingCadence("quarterly").scope, /Market Twin/i);
});
