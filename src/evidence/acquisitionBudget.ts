import type { SourceConnectionPolicy } from "../core/contracts.ts";

/** Upper bounds, not a price prediction. One micro-unit is 1/1,000,000 of currency. */
export type AcquisitionPlan = {
  currency: string;
  maxCostMicros: number;
  maxRecords: number;
  maxRequests: number;
};

export type AcquisitionBudgetPolicy = {
  currency: string;
  dailyCostMicros: number;
  dailyRecords: number;
  dailyRequests: number;
  enabled: boolean;
};

export function validBudgetInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateAcquisitionPlan(plan: AcquisitionPlan): void {
  if (!plan || typeof plan.currency !== "string" || !/^[A-Z]{3}$/.test(plan.currency) || !validBudgetInteger(plan.maxCostMicros)
    || !validBudgetInteger(plan.maxRecords) || !validBudgetInteger(plan.maxRequests) || plan.maxRequests === 0) {
    throw new Error("budget-invalid-plan");
  }
}

export function validateBudgetPolicy(policy: AcquisitionBudgetPolicy): void {
  if (!policy || typeof policy.currency !== "string" || !/^[A-Z]{3}$/.test(policy.currency) || !validBudgetInteger(policy.dailyCostMicros)
    || !validBudgetInteger(policy.dailyRecords) || !validBudgetInteger(policy.dailyRequests)
    || typeof policy.enabled !== "boolean") throw new Error("budget-invalid-policy");
}

export function validatePlanAgainstSource(plan: AcquisitionPlan, policy: SourceConnectionPolicy): void {
  validateAcquisitionPlan(plan);
  if (policy.quota !== undefined && (!validBudgetInteger(policy.quota) || plan.maxRecords > policy.quota)) throw new Error("budget-source-quota");
  // The legacy scalar has no currency. Never silently convert it to the new money contract.
  if (policy.costLimit !== undefined && (!Number.isFinite(policy.costLimit) || policy.costLimit < 0 || plan.maxCostMicros > 0)) {
    throw new Error("budget-source-cost-unit-ambiguous");
  }
}

export type AcquisitionRequestGate = {
  readonly attemptKey: string;
  authorizeRequest(upperBound: { costMicros: number; maxRecords: number }): void;
  assertCredentialAccess(): void;
  assertResult(records: number): void;
  close(): void;
};

/** Approved adapters must call this before EACH network request, including retries/pagination. */
export function createAcquisitionRequestGate(plan: AcquisitionPlan, attemptKey: string, signal: AbortSignal): AcquisitionRequestGate {
  validateAcquisitionPlan(plan);
  plan = { ...plan };
  let cost = 0;
  let records = 0;
  let requests = 0;
  let closed = false;
  const assertOpen = () => {
    if (signal.aborted) throw new Error("acquisition-cancelled");
    if (closed) throw new Error("budget-attempt-closed");
  };
  return {
    attemptKey,
    authorizeRequest(bound) {
      assertOpen();
      if (!validBudgetInteger(bound.costMicros) || !validBudgetInteger(bound.maxRecords)
        || bound.costMicros > plan.maxCostMicros - cost || bound.maxRecords > plan.maxRecords - records
        || requests >= plan.maxRequests) throw new Error("budget-request-limit");
      cost += bound.costMicros;
      records += bound.maxRecords;
      requests += 1;
    },
    assertCredentialAccess() {
      assertOpen();
      if (!requests) throw new Error("budget-request-not-authorized");
    },
    assertResult(count) {
      assertOpen();
      if (!requests || !validBudgetInteger(count) || count > records) throw new Error("budget-result-outside-authorization");
    },
    close() { closed = true; },
  };
}
