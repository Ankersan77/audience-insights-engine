import type { MeasurementConfiguration, MeasurementPlan, MetricDefinition } from "../core/contracts.ts";
import { parseCampaignScopes } from "./scope.ts";
import { hasPromptInjection, redactIdentifiers } from "../evidence/policy.ts";

const fields = ["population", "metrics", "baseline", "targets", "checkpoints", "exposureDefinition", "attributionAssumptions", "incrementalityDesign", "materialityThresholds", "decisionRules"];
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("invalid-measurement-input");
  return value as Record<string, unknown>;
}
function text(value: unknown, optional = false): string {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > 4000 || hasPromptInjection(value)) throw new Error("invalid-measurement-text");
  return redactIdentifiers(value.trim()).content;
}
function texts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("invalid-measurement-list");
  return value.map((item) => text(item));
}
export function parseMeasurementConfiguration(value: unknown): MeasurementConfiguration {
  const row = object(value, fields);
  if (!Array.isArray(row.metrics) || !row.metrics.length || row.metrics.length > 50) throw new Error("invalid-measurement-metrics");
  const metrics: MetricDefinition[] = row.metrics.map((value) => {
    const metric = object(value, ["key", "label", "unit", "direction", "aggregation", "population"]);
    if (typeof metric.key !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(metric.key) || ["constructor", "prototype"].includes(metric.key)
      || !["increase", "decrease", "target"].includes(String(metric.direction)) || !["count", "sum", "mean", "rate", "index"].includes(String(metric.aggregation))) throw new Error("invalid-measurement-metric");
    return { key: metric.key, label: text(metric.label), unit: text(metric.unit), population: text(metric.population), direction: metric.direction as MetricDefinition["direction"], aggregation: metric.aggregation as MetricDefinition["aggregation"] };
  });
  const keys = metrics.map((metric) => metric.key);
  if (new Set(keys).size !== keys.length) throw new Error("duplicate-measurement-metric");
  const numbers = (value: unknown, nonnegative = false) => {
    const values = object(value, keys);
    if (keys.some((key) => !Object.hasOwn(values, key)) || Object.values(values).some((value) => typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0))) throw new Error("invalid-measurement-values");
    return Object.fromEntries(keys.map((key) => [key, values[key] as number]));
  };
  const checkpoints = texts(row.checkpoints);
  if (!checkpoints.length || checkpoints.some((value) => !Number.isFinite(Date.parse(value)))) throw new Error("measurement-checkpoints-required");
  const attributionAssumptions = texts(row.attributionAssumptions), decisionRules = texts(row.decisionRules);
  if (!attributionAssumptions.length || !decisionRules.length) throw new Error("measurement-decisions-and-limitations-required");
  return { population: text(row.population), metrics, baseline: numbers(row.baseline), targets: numbers(row.targets), materialityThresholds: numbers(row.materialityThresholds, true),
    checkpoints, attributionAssumptions, decisionRules, exposureDefinition: text(row.exposureDefinition, true) || undefined, incrementalityDesign: text(row.incrementalityDesign, true) || undefined };
}

export function parseMeasurementInput(value: unknown): { expectedRevision: number; expectedPlanVersion: number | null; plan: Omit<MeasurementPlan, "id" | "clientId" | "campaignId"> } {
  const row = object(value, ["objective", "hypothesis", "scopeMeasurements", "expectedRevision", "expectedPlanVersion"]);
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 1
    || (row.expectedPlanVersion !== null && (typeof row.expectedPlanVersion !== "number" || !Number.isSafeInteger(row.expectedPlanVersion) || row.expectedPlanVersion < 1))) throw new Error("invalid-measurement-version");
  if (!Array.isArray(row.scopeMeasurements) || !row.scopeMeasurements.length || row.scopeMeasurements.length > 20) throw new Error("measurement-scopes-required");
  const scopeMeasurements = row.scopeMeasurements.map((value) => {
    const entry = object(value, ["scope", "measurement"]);
    return { scope: parseCampaignScopes([entry.scope])[0], measurement: parseMeasurementConfiguration(entry.measurement) };
  });
  parseCampaignScopes(scopeMeasurements.map((item) => item.scope));
  return { expectedRevision: row.expectedRevision, expectedPlanVersion: row.expectedPlanVersion as number | null,
    plan: { ...scopeMeasurements[0].measurement, objective: text(row.objective), hypothesis: text(row.hypothesis), scopeMeasurements } };
}
