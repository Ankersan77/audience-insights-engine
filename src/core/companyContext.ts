import { hasPromptInjection, redactIdentifiers } from "../evidence/textSafety.ts";

export const COMPANY_TEXT_FIELDS = ["name", "offer", "audiences", "valueProposition", "positioning", "priorities", "constraints"] as const;
export type CompanyContextContent = Record<typeof COMPANY_TEXT_FIELDS[number], string> & {
  markets: string[]; languages: string[];
  sourceBindings: { purpose: "strategy" | "crm_aggregate" | "sales_aggregate"; sourceConnectionId: number }[];
};
/** Owner-declared business context, never independent evidence or model instructions. */
export type CompanyContext = {
  schemaVersion: 1; clientId: string; version: number; content: CompanyContextContent;
  declaredBy: number; recordedAt: string; reviewAfter: string; changeReason: string;
};

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("company-context-invalid");
  return value as Record<string, unknown>;
}
function text(value: unknown, required = true): string {
  if (typeof value !== "string" || value.length > 4000 || (required && !value.trim()) || hasPromptInjection(value) || redactIdentifiers(value).identityRisk) throw new Error("company-context-invalid");
  return value.trim();
}
export function parseCompanyContextContent(value: unknown): CompanyContextContent {
  const row = object(value, [...COMPANY_TEXT_FIELDS, "markets", "languages", "sourceBindings"]);
  const scope = (value: unknown) => {
    if (!Array.isArray(value) || !value.length || value.length > 20 || value.some((item) => typeof item !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item)) || new Set(value).size !== value.length) throw new Error("company-context-invalid");
    return [...value].sort() as string[];
  };
  if (!Array.isArray(row.sourceBindings) || row.sourceBindings.length > 30) throw new Error("company-context-invalid");
  const sourceBindings = row.sourceBindings.map((value) => {
    const binding = object(value, ["purpose", "sourceConnectionId"]);
    if (!["strategy", "crm_aggregate", "sales_aggregate"].includes(String(binding.purpose)) || typeof binding.sourceConnectionId !== "number" || !Number.isSafeInteger(binding.sourceConnectionId) || binding.sourceConnectionId < 1) throw new Error("company-context-invalid");
    return { purpose: binding.purpose as CompanyContextContent["sourceBindings"][number]["purpose"], sourceConnectionId: binding.sourceConnectionId };
  });
  if (new Set(sourceBindings.map((item) => `${item.purpose}:${item.sourceConnectionId}`)).size !== sourceBindings.length) throw new Error("company-context-invalid");
  return { ...Object.fromEntries(COMPANY_TEXT_FIELDS.map((key) => [key, text(row[key], !["positioning", "priorities", "constraints"].includes(key))])) as Record<typeof COMPANY_TEXT_FIELDS[number], string>, markets: scope(row.markets), languages: scope(row.languages), sourceBindings };
}
export function parseCompanyContextEdit(value: unknown) {
  const row = object(value, ["expectedVersion", "content", "reviewAfter", "changeReason"]);
  if (row.expectedVersion !== null && (typeof row.expectedVersion !== "number" || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 1)) throw new Error("company-context-invalid");
  if (typeof row.reviewAfter !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.reviewAfter) || !Number.isFinite(Date.parse(row.reviewAfter)) || new Date(row.reviewAfter).toISOString() !== row.reviewAfter) throw new Error("company-context-invalid");
  return { expectedVersion: row.expectedVersion as number | null, content: parseCompanyContextContent(row.content), reviewAfter: row.reviewAfter, changeReason: text(row.changeReason) };
}
export function companyContextProblem(value: CompanyContext, clientId: string, now: string, market?: string, language?: string): string | undefined {
  try {
    if (value.schemaVersion !== 1 || value.clientId !== clientId || !Number.isSafeInteger(value.version) || value.version < 1) return "Company context belongs to another client or has an unsupported version.";
    parseCompanyContextContent(value.content);
    if (!Number.isSafeInteger(value.declaredBy) || value.declaredBy < 1) return "Company context requires an accountable owner declaration.";
    text(value.changeReason);
    if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(value.recordedAt)) || Date.parse(value.recordedAt) > Date.parse(now)
      || !Number.isFinite(Date.parse(value.reviewAfter)) || Date.parse(value.reviewAfter) <= Date.parse(now)) return "Company context is due for owner review; refresh it before research.";
    if ((market && !value.content.markets.includes(market)) || (language && !value.content.languages.includes(language))) return "The requested scope is outside the current company context.";
  } catch { return "Company context is invalid and requires owner review."; }
}
