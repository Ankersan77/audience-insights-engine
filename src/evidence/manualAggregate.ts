import { assertPeopleBlind, hasPromptInjection, redactIdentifiers } from "./policy.ts";

/** Explicit human transcription of a source aggregate, never automatic extraction from report prose. */
export function parseManualAggregate(value: unknown, input: { population?: string; campaigns: readonly string[]; now: string }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("aggregate-observation-required");
  const row = value as Record<string, unknown>;
  const text = (key: string) => {
    const value = row[key];
    if (typeof value !== "string" || !value.trim() || value.length > 200 || hasPromptInjection(value) || redactIdentifiers(value).identityRisk) throw new Error("invalid-aggregate-observation");
    return value.trim();
  };
  const metric = text("metricKey"), unit = text("unit"), aggregation = text("aggregation"), periodStart = text("periodStart"), periodEnd = text("periodEnd");
  const population = input.population?.trim();
  if (!population || input.campaigns.length !== 1 || !/^[1-9]\d*$/.test(input.campaigns[0]) || !["count", "sum", "mean", "rate", "index"].includes(aggregation)) throw new Error("aggregate-population-campaign-and-aggregation-required");
  if (typeof row.value !== "number" || !Number.isFinite(row.value) || typeof row.cohortSize !== "number" || !Number.isSafeInteger(row.cohortSize) || row.cohortSize < 0) throw new Error("invalid-aggregate-value-or-cohort");
  if (aggregation === "count" && (!Number.isSafeInteger(row.value) || row.value < 0)) throw new Error("invalid-aggregate-count");
  if (!Number.isFinite(Date.parse(periodStart)) || !Number.isFinite(Date.parse(periodEnd)) || Date.parse(periodStart) >= Date.parse(periodEnd) || Date.parse(periodEnd) > Date.parse(input.now)) throw new Error("invalid-aggregate-window");
  const result = { metric, value: row.value, unit, cohortSize: row.cohortSize, observedAt: periodEnd,
    dimensions: { population, aggregation, periodStart, periodEnd, campaignId: input.campaigns[0] } };
  assertPeopleBlind(result);
  if (hasPromptInjection(JSON.stringify(result)) || redactIdentifiers(JSON.stringify(result)).identityRisk) throw new Error("unsafe-aggregate-metadata");
  return result;
}
