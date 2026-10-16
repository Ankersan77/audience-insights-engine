import { validateBudgetPolicy, type AcquisitionBudgetPolicy } from "../evidence/acquisitionBudget.ts";
import { validateSynthesisBudget, type SynthesisBudgetPolicy } from "../abilities/synthesisBudget.ts";

export type BudgetEdit = { expectedVersion: number | null; confirmed: true } & (
  { kind: "acquisition"; policy: AcquisitionBudgetPolicy } | { kind: "synthesis"; policy: SynthesisBudgetPolicy }
);

export type BudgetSummary = {
  kind: "acquisition" | "synthesis";
  policy: (SynthesisBudgetPolicy & { version: number; dailyRecords?: number }) | null;
  usage: { authorizedCostMicros: string; authorizedRequests: string; authorizedRecords?: string };
  backlog?: { expiredUnresolvedAttempts: string; unknownAttempts: string; oldestExpiredAt: string | null };
};
export type BudgetWorkspace = { observedAt: string; budgets: BudgetSummary[] };

/** Exact request projection: tenant, actor, credentials and ledger mutations are never writable. */
export function parseBudgetEdit(value: unknown): BudgetEdit {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["kind", "policy", "expectedVersion", "confirmed"].includes(key))
      || !["acquisition", "synthesis"].includes(String(input.kind)) || input.confirmed !== true
      || (input.expectedVersion !== null && (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1))) throw new Error();
    const policy = input.policy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error();
    const fields = ["currency", "dailyCostMicros", "dailyRequests", "enabled", ...(input.kind === "acquisition" ? ["dailyRecords"] : [])];
    if (Object.keys(policy).some((key) => !fields.includes(key))) throw new Error();
    if (input.kind === "acquisition") validateBudgetPolicy(policy as AcquisitionBudgetPolicy);
    else validateSynthesisBudget(policy as SynthesisBudgetPolicy);
    return structuredClone(input) as BudgetEdit;
  } catch { throw new Error("budget-invalid-edit"); }
}

/** Decimal currency entry without floating-point rounding or implicit unit conversion. */
export function amountToMicros(value: string): number {
  if (!/^\d{1,10}(?:\.\d{1,6})?$/.test(value)) throw new Error("Enter a non-negative amount with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds the supported limit.");
  return Number(micros);
}

export function formatMicros(value: number | string): string {
  const micros = BigInt(value);
  const fraction = (micros % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return `${micros / BigInt(1_000_000)}${fraction ? `.${fraction}` : ""}`;
}

export function budgetCount(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Enter a non-negative whole number within the supported limit.");
  return Number(value);
}
