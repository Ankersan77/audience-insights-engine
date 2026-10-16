import { researchSnapshotDigest } from "./snapshot.ts";
import type { EvidenceItem, IntelligenceRecord, ResearchContextBasis, ResearchProject, SensingProfile, SolutionProfile } from "../core/contracts.ts";
import { hasPromptInjection, redactIdentifiers } from "../evidence/policy.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";
import { getAbility } from "./catalog.ts";

export const CONTEXT_EVIDENCE_REQUIREMENTS = [{
  sourceClasses: ["client_owned", "first_party_aggregate", "commissioned_or_licensed", "official_or_public", "public_conversation", "primary_research"] as const,
  minimumItems: 0, minimumSourceDiversity: 0, minimumGrade: "C" as const, requiredDimensions: [],
}];

export type ResearchContext = {
  clientId: string;
  market: string;
  language: string;
  project?: Pick<ResearchProject, "id" | "name" | "decision" | "updatedAt">;
  solution: Pick<SolutionProfile, "id" | "version" | "markets" | "languages" | "enabledAbilities" | "reviewRoles" | "retention">;
  sensing?: Pick<SensingProfile, "id" | "version" | "themes" | "audiences" | "competitors" | "products" | "occasions" | "risks" | "decisionContexts">;
  marketTwin: readonly Pick<IntelligenceRecord, "id" | "kind" | "title" | "statement" | "evidenceIds" | "contradictionIds" | "confidence" | "uncertainty" | "reviewedAt">[];
};

export type ResearchContextSources = {
  project?: ResearchProject | null;
  solution?: SolutionProfile | null;
  sensing?: SensingProfile | null;
  intelligence: readonly IntelligenceRecord[];
  evidence: readonly EvidenceItem[];
  /** Tenant-local connector aliases resolved to database source IDs by the loader. */
  sourceBindings: Readonly<Record<string, string>>;
};

export function prepareResearchContext(input: {
  clientId: string; abilityId: string; projectId?: string; campaignId?: string; market?: string; language?: string; now: string;
  sources: ResearchContextSources;
}): { context?: ResearchContext; basis?: ResearchContextBasis; evidence: readonly EvidenceItem[]; contextEvidence: readonly EvidenceItem[]; gaps: string[] } {
  const { solution, project, sensing } = input.sources;
  const gaps: string[] = [];
  const empty = () => ({ evidence: [], contextEvidence: [], gaps });
  const ability = getAbility(input.abilityId);
  if (!Number.isFinite(Date.parse(input.now))) gaps.push("A valid research execution time is required.");
  if (!solution || solution.clientId !== input.clientId || solution.status !== "active") gaps.push("An active solution profile for this client is required.");
  if (input.projectId && (!project || project.id !== input.projectId || project.clientId !== input.clientId || project.status !== "active")) gaps.push("An active research project belonging to this client is required.");
  if (gaps.length || !solution) return empty();
  if (!ability || !solution.enabledAbilities.some((item) => item.id === ability.id && item.version === ability.version)) gaps.push("This ability version is not enabled in the active solution profile.");
  const scopedProject = input.projectId ? project! : undefined;
  function scope(key: "markets" | "languages", requested?: string) {
    const allowed = solution![key].filter((value) => !scopedProject || scopedProject[key].includes(value));
    const selected = requested?.trim() || (allowed.length === 1 ? allowed[0] : undefined);
    if (!selected || !allowed.includes(selected)) gaps.push(`Choose one ${key === "markets" ? "market" : "language"} shared by the project and active solution profile.`);
    return selected ?? "";
  }
  const market = scope("markets", input.market);
  const language = scope("languages", input.language);
  if (solution.sensingProfileId && (!sensing || sensing.id !== solution.sensingProfileId || sensing.clientId !== input.clientId)) gaps.push("The bound sensing profile is unavailable for this client.");
  if (gaps.length) return empty();
  const aliases = Object.values(solution.providerBindings);
  if (aliases.some((alias) => !input.sources.sourceBindings[alias])) gaps.push("One or more solution source bindings are unavailable.");
  const allowedSources = new Set(aliases.map((alias) => input.sources.sourceBindings[alias]).filter(Boolean));
  const evidence = input.sources.evidence.filter((item) => item.clientId === input.clientId && allowedSources.has(item.sourceConnectionId)
    && (!input.campaignId || !item.applicability.campaigns.length || item.applicability.campaigns.includes(input.campaignId)));
  const eligible = resolveEvidence({ clientId: input.clientId, now: input.now, requirements: CONTEXT_EVIDENCE_REQUIREMENTS, evidence, market, language }).selected;
  const evidenceIds = new Set(eligible.map((item) => item.id));
  const candidates = input.sources.intelligence.filter((record) =>
    record.clientId === input.clientId && record.reviewState === "accepted" && record.lifecycle === "live"
    && Boolean(record.reviewedAt && Number.isFinite(Date.parse(record.reviewedAt)) && Date.parse(record.reviewedAt) <= Date.parse(input.now))
    && (!record.decayAt || (Number.isFinite(Date.parse(record.decayAt)) && Date.parse(record.decayAt) > Date.parse(input.now)))
    && (!record.applicability.markets.length || record.applicability.markets.includes(market))
    && (!record.applicability.languages.length || record.applicability.languages.includes(language))
    && (!input.campaignId || !record.applicability.campaigns.length || record.applicability.campaigns.includes(input.campaignId))
    && record.evidenceIds.length > 0 && record.evidenceIds.every((id) => evidenceIds.has(id))
    && !hasPromptInjection(JSON.stringify(record)) && !redactIdentifiers(JSON.stringify(record)).identityRisk,
  );
  // Contradictory reviewed statements remain separate; ingestion order never chooses a winner.
  const records = candidates.sort((a, b) => a.id.localeCompare(b.id));
  if (!records.length) gaps.push("No applicable, reviewed Market Twin record has current supporting evidence from the configured sources.");
  const supportIds = new Set(records.flatMap((record) => [...record.evidenceIds]));
  const context: ResearchContext = {
    clientId: input.clientId, market, language,
    ...(scopedProject ? { project: { id: scopedProject.id, name: redactIdentifiers(scopedProject.name).content, decision: redactIdentifiers(scopedProject.decision).content, updatedAt: scopedProject.updatedAt } } : {}),
    solution: { id: solution.id, version: solution.version, markets: solution.markets, languages: solution.languages, enabledAbilities: solution.enabledAbilities, reviewRoles: solution.reviewRoles, retention: solution.retention },
    ...(solution.sensingProfileId && sensing ? { sensing: { id: sensing.id, version: sensing.version, themes: sensing.themes, audiences: sensing.audiences, competitors: sensing.competitors, products: sensing.products, occasions: sensing.occasions, risks: sensing.risks, decisionContexts: sensing.decisionContexts } } : {}),
    marketTwin: records.map((record) => ({ id: record.id, kind: record.kind, title: record.title, statement: record.statement, evidenceIds: record.evidenceIds, contradictionIds: record.contradictionIds, confidence: record.confidence, uncertainty: record.uncertainty, reviewedAt: record.reviewedAt })),
  };
  const basis: ResearchContextBasis = {
    snapshotVersion: 1, projectDigest: scopedProject ? researchSnapshotDigest(scopedProject) : undefined,
    solutionDigest: researchSnapshotDigest(solution), sensingDigest: solution.sensingProfileId && sensing ? researchSnapshotDigest(sensing) : undefined,
    evidence: evidence.map((item) => ({ id: item.id, contentDigest: researchSnapshotDigest(item) })),
    projectId: context.project?.id, projectUpdatedAt: context.project?.updatedAt,
    solutionProfileId: solution.id, solutionVersion: solution.version, sensingProfileId: context.sensing?.id, sensingVersion: context.sensing?.version,
    market, language, excludedRecordCount: input.sources.intelligence.filter((item) => item.clientId === input.clientId).length - records.length,
    intelligence: records.map((record) => ({ id: record.id, reviewedAt: record.reviewedAt, evidenceIds: record.evidenceIds, contentDigest: researchSnapshotDigest(record) })),
  };
  return { context, basis, evidence, contextEvidence: eligible.filter((item) => supportIds.has(item.id)), gaps };
}
