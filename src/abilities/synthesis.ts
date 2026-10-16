import type { DecisionBrief, EvidenceItem } from "../core/contracts.ts";
import type { ProposedAnalysis } from "./engine.ts";
import { runAbility } from "./engine.ts";
import { prepareResearchContext, type ResearchContext, type ResearchContextSources } from "./context.ts";
import { assertPeopleBlind, redactIdentifiers } from "../evidence/policy.ts";
import { resolveEvidence } from "../market-twin/resolver.ts";
import { getDecisionBriefAbility } from "./catalog.ts";

export type ResearchSynthesisInput = {
  clientId: string;
  abilityId: string;
  question: string;
  market?: string;
  language?: string;
  context?: ResearchContext;
  evidence: readonly Pick<EvidenceItem, "id" | "sourceClass" | "externalReference" | "sourceContent" | "synthesis" | "method" | "applicability" | "confidence" | "grade" | "observedAt" | "publishedAt">[];
};

export interface ResearchSynthesisProvider {
  readonly id: string;
  readonly version: string;
  synthesize(input: ResearchSynthesisInput): Promise<unknown>;
}

/** Provider output is untrusted data even when a TypeScript adapter promises a shape. */
function proposedAnalysis(value: unknown): ProposedAnalysis {
  if (!value || typeof value !== "object") throw new Error("invalid-synthesis-output");
  const record = value as Record<string, unknown>;
  const text = (key: string) => {
    const item = record[key];
    if (typeof item !== "string" || !item.trim() || item.length > 12_000) throw new Error("invalid-synthesis-output");
    return redactIdentifiers(item.trim()).content;
  };
  const strings = (key: string) => {
    const items = record[key];
    if (!Array.isArray(items) || items.length > 200 || items.some((item) => typeof item !== "string" || item.length > 12_000)) throw new Error("invalid-synthesis-output");
    return items.map((item: string) => redactIdentifiers(item).content);
  };
  if (!["attitude", "behavior", "demand_proxy", "causal", "descriptive"].includes(String(record.claimMode))) throw new Error("invalid-synthesis-output");
  return { pointOfView: text("pointOfView"), clientRelevance: text("clientRelevance"), recommendation: text("recommendation"), nextDecision: text("nextDecision"),
    claimMode: record.claimMode as ProposedAnalysis["claimMode"], evidenceIds: strings("evidenceIds"), contradictions: strings("contradictions"), uncertainty: strings("uncertainty"),
    // A model cannot approve its own causal study. Reviewed study authority must come from Core.
  };
}

/**
 * Provider-neutral orchestration. Evidence selection and final claim policy
 * remain deterministic Core responsibilities; a provider may only propose the
 * analysis between those two gates.
 */
export async function runAbilityWithSynthesis(input: {
  clientId: string;
  abilityId: string;
  question: string;
  evidence: readonly EvidenceItem[];
  contextEvidence?: readonly EvidenceItem[];
  context?: ResearchContext;
  market?: string;
  language?: string;
  now: string;
  provider?: ResearchSynthesisProvider;
}): Promise<DecisionBrief> {
  const preliminary = runAbility(input);
  const selectionGaps = preliminary.researchGaps.filter((gap) => gap !== "No evidence-backed analysis has been supplied.");
  if (selectionGaps.length > 0) return preliminary;
  if (!input.provider) return { ...preliminary, researchGaps: [...preliminary.researchGaps, "No research synthesis provider is configured."] };
  const selected = new Set(preliminary.evidenceIds);
  const evidence = [...new Map([...input.evidence, ...(input.contextEvidence ?? [])].map((item) => [item.id, item])).values()].filter((item) => selected.has(item.id)).map((item) => ({
    id: item.id, sourceClass: item.sourceClass, externalReference: item.externalReference,
    // Never hide a report's later caveats by silently clipping the selected text.
    // A bounded adapter must reject oversized input or request a reviewed extract.
    sourceContent: item.sourceContent, synthesis: item.synthesis, method: item.method,
    applicability: item.applicability, confidence: item.confidence, grade: item.grade,
    observedAt: item.observedAt, publishedAt: item.publishedAt,
  }));
  try {
    const payload: ResearchSynthesisInput = { clientId: input.clientId, abilityId: input.abilityId, question: input.question,
      market: input.market, language: input.language, evidence, context: input.context };
    assertPeopleBlind(payload);
    const analysis = proposedAnalysis(await input.provider.synthesize(payload));
    return { ...runAbility({ ...input, analysis }), synthesisProvider: { id: input.provider.id, version: input.provider.version } };
  } catch {
    return { ...preliminary, researchGaps: [...preliminary.researchGaps, "Research synthesis failed or returned an invalid result. Retry after checking the configured provider."] };
  }
}

/** Shared product path for human-authored and provider-generated research. */
export async function runContextualResearch(input: {
  clientId: string; abilityId: string; question: string; projectId?: string; market?: string; language?: string; now: string;
  sources: ResearchContextSources; analysis?: ProposedAnalysis; provider?: ResearchSynthesisProvider;
}): Promise<DecisionBrief> {
  const prepared = prepareResearchContext(input);
  const basisFor = (brief: DecisionBrief) => prepared.basis ? {
    ...prepared.basis, evidence: prepared.basis.evidence?.filter((item) => brief.evidenceIds.includes(item.id)),
    primaryEvidenceIds: resolveEvidence({ clientId: input.clientId, now: input.now, market: prepared.context?.market, language: prepared.context?.language,
      requirements: getDecisionBriefAbility(input.abilityId)!.evidenceRequirements, evidence: prepared.evidence }).selected.map((item) => item.id),
  } : undefined;
  const execution = { clientId: input.clientId, abilityId: input.abilityId, question: input.question, now: input.now,
    market: prepared.context?.market ?? input.market, language: prepared.context?.language ?? input.language,
    evidence: prepared.evidence, contextEvidence: prepared.contextEvidence,
  };
  if (prepared.gaps.length) {
    const brief = runAbility(execution);
    return { ...brief, status: "needs_context", researchGaps: [...prepared.gaps, ...brief.researchGaps], contextBasis: basisFor(brief) };
  }
  const brief = input.analysis ? runAbility({ ...execution, analysis: input.analysis })
    : await runAbilityWithSynthesis({ ...execution, provider: input.provider, context: prepared.context });
  const contradictions = prepared.context!.marketTwin.flatMap((record) => record.contradictionIds.map((id) => `Reviewed Market Twin record ${record.id} references a contradiction with record ${id}.`));
  return { ...brief, contextBasis: basisFor(brief), contradictions: [...new Set([...brief.contradictions, ...contradictions])] };
}

