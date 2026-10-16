import type { BudgetWorkspace } from "@/src/core/budgetAdministration";
import { inspectAcquisitionBudget } from "./acquisition_budget";
import { inspectSynthesisBudget } from "./synthesis_budget";

/** Read only after an authenticated admin/owner check; stable client ID comes from the session.
 * A concurrent slug rename/reuse must never redirect this read to another client's budget.
 */
export async function loadBudgetWorkspace(clientId: number): Promise<BudgetWorkspace> {
  const [acquisition, synthesis] = await Promise.all([inspectAcquisitionBudget(clientId), inspectSynthesisBudget(clientId)]);
  const a = acquisition.policy, s = synthesis.policy;
  return { observedAt: new Date().toISOString(), budgets: [
    { kind: "acquisition", policy: a ? { currency: a.currency, dailyCostMicros: a.dailyCostMicros, dailyRequests: a.dailyRequests, dailyRecords: a.dailyRecords, enabled: a.enabled, version: a.version } : null,
      usage: { authorizedCostMicros: acquisition.usage.authorizedCostMicros, authorizedRequests: acquisition.usage.authorizedRequests, authorizedRecords: acquisition.usage.authorizedRecords } },
    { kind: "synthesis", policy: s ? { currency: s.currency, dailyCostMicros: s.dailyCostMicros, dailyRequests: s.dailyRequests, enabled: s.enabled, version: s.version } : null,
      usage: { authorizedCostMicros: synthesis.usage.authorizedCostMicros, authorizedRequests: synthesis.usage.authorizedRequests }, backlog: synthesis.backlog },
  ] };
}
