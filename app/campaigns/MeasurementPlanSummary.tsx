import type { MeasurementPlan } from "@/src/core/contracts";
import { campaignScopeKey } from "@/src/campaigns/scope";

export function MeasurementPlanSummary({ plan }: { plan: MeasurementPlan }) {
  if (!plan.scopeMeasurements) return <p className="mt-3 text-xs text-muted">Historical shared plan. Multi-market proposals need an explicit per-pair replacement before approval.</p>;
  return <div className="mt-3 grid gap-3">{plan.scopeMeasurements.map(({ scope, measurement }) => <details key={campaignScopeKey(scope)} className="rounded-md border border-border p-3 text-sm">
    <summary>{campaignScopeKey(scope)} · {measurement.metrics.length} metric(s) · {measurement.population}</summary>
    {measurement.metrics.map((metric) => <div key={metric.key} className="mt-2 border-t border-border pt-2"><strong>{metric.label}</strong><p>{metric.population} · {metric.unit} · {metric.aggregation} · {metric.direction}</p><p>Baseline {measurement.baseline[metric.key]} → target {measurement.targets[metric.key]}; materiality {measurement.materialityThresholds[metric.key]}</p></div>)}
    <p className="mt-2">Checkpoints: {measurement.checkpoints.join(", ")}</p><p>Exposure: {measurement.exposureDefinition || "Not declared"}</p>
    <p>Attribution limits: {measurement.attributionAssumptions.join("; ")}</p><p>Incrementality design: {measurement.incrementalityDesign || "Not declared"}</p><p>Decision rules: {measurement.decisionRules.join("; ")}</p>
    <p className="mt-2 text-xs text-muted">No pooling, causal effect or Brand Lift is established by this measurement plan.</p>
  </details>)}</div>;
}
