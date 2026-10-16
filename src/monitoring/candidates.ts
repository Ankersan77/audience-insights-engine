import { createHash } from "node:crypto";
import type { Applicability, SourceClass } from "../core/contracts.ts";
import type { SignalCandidate } from "./engine.ts";

export type MonitoringObservation = {
  evidenceId: string;
  clientId: string;
  sourceConnectionId: string;
  sourceClass: SourceClass;
  metricKey: string;
  value: number;
  unit: string;
  observedAt: string;
  dimensions: Readonly<Record<string, string>>;
  cohortSize?: number;
  confidence: number;
  applicability: Applicability;
  suppressed: boolean;
};

export type DerivedSignalCandidate = SignalCandidate & {
  evidenceIds: readonly string[];
  applicability: Applicability;
  unit: string;
  metricKey: string;
};

function stableDimensions(value: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function observationKey(item: MonitoringObservation): string {
  return `${item.metricKey}\u0000${item.unit}\u0000${stableDimensions(item.dimensions)}`;
}

function weightedMean(items: readonly MonitoringObservation[], field: "value" | "confidence"): number {
  const totalWeight = items.reduce((sum, item) => sum + Math.max(item.cohortSize ?? 1, 1), 0);
  return items.reduce((sum, item) => sum + item[field] * Math.max(item.cohortSize ?? 1, 1), 0) / totalWeight;
}

function risk(item: MonitoringObservation, key: "botRisk" | "manipulationRisk"): number {
  const raw = item.dimensions[key] ?? item.dimensions[key === "botRisk" ? "bot_risk" : "manipulation_risk"];
  if (raw !== undefined) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
  }
  return item.sourceClass === "public_conversation" ? 1 : 0;
}

function seasonalExpectation(items: readonly MonitoringObservation[]): number | undefined {
  const values = items.flatMap((item) => {
    const raw = item.dimensions.seasonalExpectation ?? item.dimensions.seasonal_expectation;
    if (raw === undefined) return [];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? [parsed] : [];
  });
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unionApplicability(items: readonly MonitoringObservation[]): Applicability {
  const union = (key: keyof Applicability) => [...new Set(items.flatMap((item) => [...item.applicability[key]]))].sort();
  return {
    markets: union("markets"),
    languages: union("languages"),
    categories: union("categories"),
    audiences: union("audiences"),
    campaigns: union("campaigns"),
  };
}

/**
 * Builds comparable signal candidates only from non-suppressed canonical observations.
 * The latest prior observation per source is used as the historical baseline so a
 * high-frequency source cannot dominate corroboration by emitting repeated rows.
 */
export function buildQuantitativeSignalCandidates(input: {
  clientId: string;
  current: readonly MonitoringObservation[];
  history: readonly MonitoringObservation[];
}): DerivedSignalCandidate[] {
  const current = input.current.filter((item) => !item.suppressed && item.clientId === input.clientId);
  const history = input.history.filter((item) => !item.suppressed && item.clientId === input.clientId);
  const groups = new Map<string, MonitoringObservation[]>();
  for (const item of current) groups.set(observationKey(item), [...(groups.get(observationKey(item)) ?? []), item]);

  return [...groups.entries()].map(([key, observations]) => {
    const earliestCurrent = Math.min(...observations.map((item) => Date.parse(item.observedAt)));
    const historical = history
      .filter((item) => observationKey(item) === key && Date.parse(item.observedAt) < earliestCurrent)
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
    const latestBySource = new Map<string, MonitoringObservation>();
    for (const item of historical) if (!latestBySource.has(item.sourceConnectionId)) latestBySource.set(item.sourceConnectionId, item);
    const baseline = [...latestBySource.values()];
    const representative = observations[0];
    const digest = createHash("sha256").update(`${input.clientId}\u0000${key}\u0000${observations.map((item) => item.evidenceId).sort().join(",")}`).digest("hex").slice(0, 20);
    return {
      id: `quantitative:${digest}`,
      clientId: input.clientId,
      theme: representative.dimensions.theme ?? representative.metricKey,
      metricKey: representative.metricKey,
      unit: representative.unit,
      currentValue: weightedMean(observations, "value"),
      baselineValue: baseline.length ? weightedMean(baseline, "value") : undefined,
      seasonalExpectation: seasonalExpectation(observations),
      confidence: weightedMean(observations, "confidence"),
      observedAt: new Date(Math.max(...observations.map((item) => Date.parse(item.observedAt)))).toISOString(),
      sourceIds: [...new Set(observations.map((item) => item.sourceConnectionId))].sort(),
      botRisk: Math.max(...observations.map((item) => risk(item, "botRisk"))),
      manipulationRisk: Math.max(...observations.map((item) => risk(item, "manipulationRisk"))),
      sampleSize: observations.reduce((sum, item) => sum + (item.cohortSize ?? 0), 0),
      evidenceIds: [...new Set(observations.map((item) => item.evidenceId))].sort(),
      applicability: unionApplicability(observations),
    };
  });
}
