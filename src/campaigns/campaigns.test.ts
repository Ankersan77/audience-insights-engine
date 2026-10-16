import assert from "node:assert/strict";
import test from "node:test";
import type { Campaign, MeasurementPlan } from "../core/contracts.ts";
import { assessLiveCampaign, assessPostCampaign, assessPreflight, transitionCampaign } from "./analysis.ts";

const campaign: Campaign = {
  id: "campaign-1",
  clientId: "client-a",
  name: "Launch",
  state: "proposed",
  revision: 1,
  objective: "Increase qualified consideration",
  audience: "Declared segment",
  proposition: "A substantiated product promise",
  creativeRoutes: ["route-a"],
  channels: ["owned", "paid"],
  budgetAssumptions: ["Budget remains within approved range"],
};

const plan: MeasurementPlan = {
  id: "plan-1",
  clientId: "client-a",
  campaignId: campaign.id,
  objective: campaign.objective,
  hypothesis: "Exposed eligible audiences show higher qualified consideration than the control.",
  population: "Eligible audience in DK",
  metrics: [{ key: "consideration", label: "Consideration", unit: "rate", direction: "increase", aggregation: "rate", population: "Eligible audience" }],
  baseline: { consideration: 0.24 },
  targets: { consideration: 0.28 },
  checkpoints: ["2026-11-01T00:00:00.000Z"],
  exposureDefinition: "Verified campaign exposure",
  attributionAssumptions: ["No material concurrent campaign"],
  incrementalityDesign: "Randomized holdout",
  materialityThresholds: { consideration: 0.02 },
  decisionRules: ["Scale only when the confidence interval and practical threshold both pass"],
};

test("preflight cannot pass without a measurement plan", () => {
  const result = assessPreflight({ campaign, strategicEvidence: [], brandConstraints: [] });
  assert.equal(result.status, "needs_context");
  assert.ok(result.researchGaps.some((gap) => /measurement plan/i.test(gap)));
});

test("campaign lifecycle preserves explicit states and revisions", () => {
  const approved = transitionCampaign(campaign, "approved");
  const active = transitionCampaign(approved, "active");
  assert.equal(active.state, "active");
  assert.equal(active.revision, 3);
  assert.throws(() => transitionCampaign(campaign, "completed"));
});

test("live analysis explicitly refuses causal learning", () => {
  const active = { ...campaign, state: "active" as const };
  const result = assessLiveCampaign({
    campaign: active,
    baseline: { consideration: 0.24 },
    current: { consideration: 0.29 },
    anomalies: [],
    contextualChanges: ["A competitor launched during the same week"],
  });
  assert.equal(result.status, "ready");
  assert.match(result.pointOfView, /not causal/i);
  assert.ok(result.watchouts.length > 0);
});

test("post-campaign learning remains conditional and review-gated", () => {
  const completed = { ...campaign, state: "completed" as const };
  const result = assessPostCampaign({
    campaign: completed,
    plan,
    observedResults: { consideration: 0.29 },
    dataQualityIssues: [],
    alternativeExplanations: ["Competitor activity changed"],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.candidateLearning?.requiresReview, true);
  assert.ok(result.candidateLearning?.conditions.includes("Competitor activity changed"));
});
