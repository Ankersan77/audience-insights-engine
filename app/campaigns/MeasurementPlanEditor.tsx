"use client";

import { useState } from "react";
import type { CampaignScope, MeasurementConfiguration } from "@/src/core/contracts";
import type { CampaignWorkspaceRow } from "@/src/db/queries/campaign_workspace";
import { campaignScopeKey } from "@/src/campaigns/scope";

const style = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal";
const listFields = ["checkpoints", "attributionAssumptions", "decisionRules"] as const;
const optionalFields = ["exposureDefinition", "incrementalityDesign"] as const;
const metricFields = ["key", "label", "population", "unit", "baseline", "target", "materiality"] as const;

function ScopeFields({ scope, index, initial }: { scope: CampaignScope; index: number; initial?: MeasurementConfiguration }) {
  const [count, setCount] = useState(initial?.metrics.length || 1);
  return <fieldset className="grid min-w-0 gap-3 rounded-md border border-border p-4 md:grid-cols-2">
    <legend className="px-1 font-medium">{campaignScopeKey(scope)} measurement</legend>
    <input type="hidden" name={`${index}-metric-count`} value={count} />
    <label className="text-xs font-medium">Population<input required maxLength={4000} name={`${index}-population`} defaultValue={initial?.population} className={style} /></label>
    {listFields.map((field) => <label key={field} className="text-xs font-medium">{field.replace(/([A-Z])/g, " $1")}<input required name={`${index}-${field}`} maxLength={4000} defaultValue={initial?.[field].join(", ")} placeholder={field === "checkpoints" ? "ISO dates, comma-separated" : "Comma-separated"} className={style} /></label>)}
    {optionalFields.map((field) => <label key={field} className="text-xs font-medium">{field.replace(/([A-Z])/g, " $1")}<input name={`${index}-${field}`} maxLength={4000} defaultValue={initial?.[field]} className={style} /></label>)}
    {Array.from({ length: count }, (_, metricIndex) => {
      const metric = initial?.metrics[metricIndex];
      const values = { ...metric, baseline: metric && initial?.baseline[metric.key], target: metric && initial?.targets[metric.key], materiality: metric && initial?.materialityThresholds[metric.key] };
      return <fieldset key={metricIndex} className="grid min-w-0 gap-3 rounded-md border border-border p-3 md:col-span-2 md:grid-cols-3"><legend className="px-1 text-sm">Metric {metricIndex + 1}</legend>
        {metricFields.map((field) => <label key={field} className="text-xs font-medium">{field}<input required name={`${index}-metric-${metricIndex}-${field}`} defaultValue={values[field]} type={["baseline", "target", "materiality"].includes(field) ? "number" : "text"} step="any" min={field === "materiality" ? 0 : undefined} maxLength={4000} className={style} /></label>)}
        <label className="text-xs font-medium">Direction<select name={`${index}-metric-${metricIndex}-direction`} defaultValue={metric?.direction ?? "increase"} className={style}><option>increase</option><option>decrease</option><option>target</option></select></label>
        <label className="text-xs font-medium">Aggregation<select name={`${index}-metric-${metricIndex}-aggregation`} defaultValue={metric?.aggregation ?? "rate"} className={style}><option>rate</option><option>count</option><option>mean</option><option>index</option><option>sum</option></select></label>
      </fieldset>;
    })}
    <div className="flex gap-2 md:col-span-2"><button type="button" disabled={count >= 50} onClick={() => setCount(count + 1)} className="rounded-md border border-border px-3 py-2 text-sm">Add metric</button>{count > 1 ? <button type="button" onClick={() => setCount(count - 1)} className="rounded-md border border-border px-3 py-2 text-sm">Remove last metric</button> : null}</div>
  </fieldset>;
}

export function MeasurementPlanEditor({ row, onSubmit }: { row: CampaignWorkspaceRow; onSubmit(event: React.FormEvent<HTMLFormElement>): void }) {
  const scopes = row.payload.campaign.targetScopes ?? [];
  if (!scopes.length) return <p className="mt-3 text-sm text-muted">Declare campaign scope before creating a measurement plan.</p>;
  return <form onSubmit={onSubmit} className="mt-5 grid gap-4 rounded-md border border-border p-4">
    <h3 className="font-medium">{row.measurementPlan ? "Replacement plan — requires new review and pre-flight" : "Measurement plan required before approval"}</h3>
    <p className="text-xs text-muted">Set metrics, populations, baselines and targets separately for each pair. This whole version is reviewed and frozen together; no pooled result is implied.</p>
    {(["objective", "hypothesis"] as const).map((field) => <label key={field} className="text-xs font-medium">{field}<input required maxLength={4000} name={field} defaultValue={row.measurementPlan?.[field]} className={style} /></label>)}
    {scopes.map((scope, index) => <ScopeFields key={campaignScopeKey(scope)} scope={scope} index={index} initial={row.measurementPlan?.scopeMeasurements?.find((item) => campaignScopeKey(item.scope) === campaignScopeKey(scope))?.measurement ?? (scopes.length === 1 && row.measurementPlan?.targetScopes?.length === 1 ? row.measurementPlan : undefined)} />)}
    <button className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]">Save measurement plan</button>
  </form>;
}

export function measurementRequest(data: FormData, row: CampaignWorkspaceRow) {
  const text = (name: string) => String(data.get(name) ?? "");
  const list = (name: string) => text(name).split(",").map((item) => item.trim()).filter(Boolean);
  const number = (name: string) => text(name).trim() ? Number(text(name)) : null;
  return { objective: text("objective"), hypothesis: text("hypothesis"), expectedRevision: row.currentRevision, expectedPlanVersion: row.measurementPlanVersion,
    scopeMeasurements: row.payload.campaign.targetScopes?.map((scope, index) => {
      const metrics = Array.from({ length: Number(text(`${index}-metric-count`)) }, (_, metricIndex) => {
        const prefix = `${index}-metric-${metricIndex}`;
        return { prefix, key: text(`${prefix}-key`), label: text(`${prefix}-label`), unit: text(`${prefix}-unit`), population: text(`${prefix}-population`), direction: text(`${prefix}-direction`), aggregation: text(`${prefix}-aggregation`) };
      });
      return { scope, measurement: { population: text(`${index}-population`), metrics: metrics.map((metric) => ({ key: metric.key, label: metric.label, unit: metric.unit, population: metric.population, direction: metric.direction, aggregation: metric.aggregation })),
        baseline: Object.fromEntries(metrics.map((metric) => [metric.key, number(`${metric.prefix}-baseline`)])), targets: Object.fromEntries(metrics.map((metric) => [metric.key, number(`${metric.prefix}-target`)])), materialityThresholds: Object.fromEntries(metrics.map((metric) => [metric.key, number(`${metric.prefix}-materiality`)])),
        ...Object.fromEntries(listFields.map((field) => [field, list(`${index}-${field}`)])), ...Object.fromEntries(optionalFields.map((field) => [field, text(`${index}-${field}`)])) } };
    }) };
}
