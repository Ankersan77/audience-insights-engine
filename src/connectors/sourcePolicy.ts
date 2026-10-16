import type { SourceConnectionPolicy, RightsDeclaration, SourceClass } from "../core/contracts.ts";
import type { SourceAcquisitionReceipt, SourceAcquisitionRequest } from "./contracts.ts";
import type { DataClassification } from "./contracts.ts";

const CADENCES = ["manual", "hourly", "daily", "weekly", "monthly", "quarterly"] as const;
const CLASSIFICATIONS = ["public", "licensed", "client-confidential"] as const;

export class SourcePolicyError extends Error {}

export function sourceClassification(sourceClass: SourceClass): DataClassification {
  if (sourceClass === "official_or_public" || sourceClass === "public_conversation") return "public";
  if (sourceClass === "commissioned_or_licensed") return "licensed";
  return "client-confidential";
}

export function readSourceConnectionPolicy(value: unknown): SourceConnectionPolicy {
  const policy = value && typeof value === "object" ? value as Partial<SourceConnectionPolicy> : {};
  const strings = (candidate: unknown): string[] => Array.isArray(candidate)
    ? [...new Set(candidate.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  const cadence = CADENCES.includes(policy.cadence as typeof CADENCES[number]) ? policy.cadence as SourceConnectionPolicy["cadence"] : "manual";
  return {
    permissions: strings(policy.permissions),
    dataClassifications: strings(policy.dataClassifications).filter((item): item is SourceConnectionPolicy["dataClassifications"][number] => CLASSIFICATIONS.includes(item as typeof CLASSIFICATIONS[number])),
    permittedPurposes: strings(policy.permittedPurposes),
    markets: strings(policy.markets),
    languages: strings(policy.languages),
    cadence,
    lookbackDays: Number.isInteger(policy.lookbackDays) && Number(policy.lookbackDays) > 0 ? Number(policy.lookbackDays) : 0,
    ...(typeof policy.quota === "number" ? { quota: policy.quota } : {}),
    ...(typeof policy.costLimit === "number" ? { costLimit: policy.costLimit } : {}),
  };
}

function requestValues(request: SourceAcquisitionRequest, key: "markets" | "languages"): string[] {
  const value = request.filters?.[key];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function sourcePolicyFailure(input: {
  health: string;
  rights: RightsDeclaration;
  policy: SourceConnectionPolicy;
  request: SourceAcquisitionRequest;
  dataClassification: DataClassification;
  now: string;
}): string | null {
  if (input.health === "unavailable") return "source-unavailable";
  if (!input.rights.commercialUse) return "source-rights-denied";
  if (!Number.isFinite(Date.parse(input.now))) return "source-time-invalid";
  if (input.rights.expiresAt && !Number.isFinite(Date.parse(input.rights.expiresAt))) return "source-rights-invalid";
  if (input.rights.expiresAt && Date.parse(input.rights.expiresAt) <= Date.parse(input.now)) return "source-rights-expired";
  if (!input.policy.permissions.length || !input.policy.dataClassifications.length || !input.policy.permittedPurposes.length || !input.policy.markets.length || !input.policy.languages.length || input.policy.lookbackDays <= 0) {
    return "source-policy-incomplete";
  }
  if (!input.policy.dataClassifications.includes(input.dataClassification)) return "source-classification-outside-policy";
  const purpose = input.request.filters?.purpose ?? "market-research";
  if (typeof purpose !== "string" || !input.policy.permittedPurposes.includes(purpose)) return "source-purpose-outside-policy";
  for (const key of ["markets", "languages"] as const) {
    const allowed = new Set(input.policy[key]);
    if (requestValues(input.request, key).some((value) => !allowed.has(value))) return `source-${key}-outside-policy`;
  }
  if (input.request.since) {
    const since = new Date(input.request.since).getTime();
    const until = new Date(input.request.until ?? input.now).getTime();
    if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) return "source-window-invalid";
    if (until - since > input.policy.lookbackDays * 86_400_000) return "source-lookback-exceeded";
  }
  return null;
}

export function acquisitionLimitFailure(policy: SourceConnectionPolicy, receipt: SourceAcquisitionReceipt): string | null {
  if (![receipt.acquiredCount, receipt.rejectedCount].every((value) => Number.isSafeInteger(value) && value >= 0)) return "source-receipt-invalid";
  if (policy.quota !== undefined && (!Number.isSafeInteger(policy.quota) || policy.quota < 0)) return "source-quota-invalid";
  if (policy.costLimit !== undefined && (!Number.isFinite(policy.costLimit) || policy.costLimit < 0)) return "source-cost-limit-invalid";
  if (receipt.estimatedCost !== undefined && (!Number.isFinite(receipt.estimatedCost) || receipt.estimatedCost < 0)) return "source-cost-invalid";
  if (policy.quota !== undefined && receipt.acquiredCount + receipt.rejectedCount > policy.quota) return "source-quota-exceeded";
  if (policy.costLimit !== undefined && receipt.estimatedCost === undefined) return "source-cost-unreported";
  if (policy.costLimit !== undefined && receipt.estimatedCost !== undefined && receipt.estimatedCost > policy.costLimit) return "source-cost-limit-exceeded";
  return null;
}
