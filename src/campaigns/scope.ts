import type { CampaignScope } from "../core/contracts.ts";

export function parseCampaignScopes(value: unknown): CampaignScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error("campaign-target-scopes-required");
  const scopes = value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid-campaign-target-scope");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["market", "language"].includes(key))
      || ![row.market, row.language].every((text) => typeof text === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(text))) throw new Error("invalid-campaign-target-scope");
    return { market: row.market as string, language: row.language as string };
  });
  if (new Set(scopes.map(campaignScopeKey)).size !== scopes.length) throw new Error("duplicate-campaign-target-scope");
  return scopes.sort((a, b) => campaignScopeKey(a).localeCompare(campaignScopeKey(b)));
}

export function campaignScopeKey(scope: CampaignScope): string { return `${scope.market}/${scope.language}`; }

export function campaignScopesFromText(text: string): CampaignScope[] {
  if (text.length > 4000) throw new Error("invalid-campaign-target-scope");
  return parseCampaignScopes(text.split(/[,\n]/).filter((item) => item.trim()).map((item) => {
    const parts = item.trim().split("/");
    if (parts.length !== 2) throw new Error("Use market/language pairs, for example DK/da, SE/sv.");
    return { market: parts[0].trim(), language: parts[1].trim() };
  }));
}

export function resolveCampaignScope(targetScopes: unknown, market?: string, language?: string): CampaignScope {
  const scopes = parseCampaignScopes(targetScopes);
  const selected = scopes.length === 1 ? { market: market || scopes[0].market, language: language || scopes[0].language } : { market, language };
  const match = scopes.find((scope) => scope.market === selected.market && scope.language === selected.language);
  if (!match) throw new Error("Select a declared campaign market/language pair; a review cannot approve other scopes.");
  return match;
}

export function sameCampaignScopes(first: unknown, second: unknown): boolean {
  try { return JSON.stringify(parseCampaignScopes(first)) === JSON.stringify(parseCampaignScopes(second)); } catch { return false; }
}
