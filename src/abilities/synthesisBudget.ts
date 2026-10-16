import { getDecisionBriefAbility } from "./catalog.ts";

export type SynthesisBudgetPolicy = {
  currency: string;
  dailyCostMicros: number;
  dailyRequests: number;
  enabled: boolean;
};

/** Trusted adapter upper bound, never a user-provided price or a token-price estimate. */
export type SynthesisSpendPlan = {
  currency: string;
  maxCostMicros: number;
  providerId: string;
  providerVersion: string;
  model: string;
  approvalReference: string;
  bindingExpiresAt: string;
  maxInputBytes: number;
  maxOutputTokens: number;
  maxDurationMs: number;
};

export type SynthesisAttempt = {
  clientId: string;
  attemptKey: string;
  abilityId: string;
  inputDigest: string;
  plan: SynthesisSpendPlan;
};
export type SynthesisPermit = { clientId: string; id: string };
export type SynthesisOutcome = "succeeded" | "failed" | "cancelled" | "unknown";

/** Every method persists before resolving. Dispatch is a one-use claim, not a read check. */
export interface SynthesisSpendLedger {
  reserve(attempt: SynthesisAttempt): Promise<SynthesisPermit>;
  dispatch(permit: SynthesisPermit): Promise<{ expiresAt: string }>;
  finish(permit: SynthesisPermit, outcome: SynthesisOutcome): Promise<{ accepted: boolean }>;
}

const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const currency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const reference = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$/.test(value);

export function validateSynthesisBudget(policy: SynthesisBudgetPolicy): void {
  if (!policy || !currency(policy.currency) || !integer(policy.dailyCostMicros) || !integer(policy.dailyRequests)
    || typeof policy.enabled !== "boolean") throw new Error("synthesis-budget-invalid-policy");
}

export function validateSynthesisPlan(plan: SynthesisSpendPlan): void {
  if (!plan || !currency(plan.currency) || !integer(plan.maxCostMicros)
    || ![plan.providerId, plan.providerVersion, plan.model, plan.approvalReference].every(reference)
    || typeof plan.bindingExpiresAt !== "string" || !Number.isFinite(Date.parse(plan.bindingExpiresAt))
    || !integer(plan.maxInputBytes) || plan.maxInputBytes < 1024 || plan.maxInputBytes > 1_000_000
    || !integer(plan.maxOutputTokens) || plan.maxOutputTokens < 256 || plan.maxOutputTokens > 32_768
    || !integer(plan.maxDurationMs) || plan.maxDurationMs < 1 || plan.maxDurationMs > 120_000)
    throw new Error("synthesis-budget-invalid-plan");
}

export function validateSynthesisAttempt(attempt: SynthesisAttempt): void {
  validateSynthesisPlan(attempt.plan);
  if (!/^[1-9]\d*$/.test(attempt.clientId) || !Number.isSafeInteger(Number(attempt.clientId))
    || !/^[a-f0-9-]{36}$/.test(attempt.attemptKey) || !/^[a-f0-9]{64}$/.test(attempt.inputDigest)
    || !getDecisionBriefAbility(attempt.abilityId)) throw new Error("synthesis-budget-invalid-attempt");
}
