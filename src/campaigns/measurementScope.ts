import type { CampaignScope, MeasurementConfiguration, MeasurementPlan } from "../core/contracts.ts";
import { campaignScopeKey, parseCampaignScopes, resolveCampaignScope, sameCampaignScopes } from "./scope.ts";

/** Explicit allowlist: nested payloads cannot replace plan identity, review scope or objectives. */
export function measurementConfiguration(value: MeasurementConfiguration): MeasurementConfiguration {
  return { population: value.population, metrics: value.metrics, baseline: value.baseline, targets: value.targets,
    checkpoints: value.checkpoints, exposureDefinition: value.exposureDefinition, attributionAssumptions: value.attributionAssumptions,
    incrementalityDesign: value.incrementalityDesign, materialityThresholds: value.materialityThresholds, decisionRules: value.decisionRules };
}

export function measurementForScope(plan: MeasurementPlan, scope: CampaignScope): MeasurementPlan {
  const scopes = parseCampaignScopes(plan.targetScopes);
  resolveCampaignScope(scopes, scope.market, scope.language);
  if (!plan.scopeMeasurements) {
    if (scopes.length !== 1) throw new Error("explicit-per-scope-measurement-required");
    return plan; // Historical single-pair plans retain their original meaning.
  }
  if (!sameCampaignScopes(scopes, plan.scopeMeasurements.map((item) => item.scope))) throw new Error("measurement-scope-coverage-mismatch");
  const match = plan.scopeMeasurements.find((item) => campaignScopeKey(item.scope) === campaignScopeKey(scope));
  if (!match) throw new Error("measurement-scope-required");
  return { ...plan, ...measurementConfiguration(match.measurement) };
}
