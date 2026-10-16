import type { DecisionBrief, EvidenceItem } from "../core/contracts.ts";
import type { ProposedAnalysis } from "./engine.ts";
import { runAbility } from "./engine.ts";

export type ResearchSynthesisInput = {
  clientId: string;
  abilityId: string;
  question: string;
  market?: string;
  language?: string;
  evidence: readonly Pick<EvidenceItem, "id" | "sourceClass" | "externalReference" | "sourceContent" | "synthesis" | "method" | "applicability" | "confidence" | "grade" | "observedAt" | "publishedAt">[];
};

export interface ResearchSynthesisProvider {
  readonly id: string;
  readonly version: string;
  synthesize(input: ResearchSynthesisInput): Promise<ProposedAnalysis>;
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
  market?: string;
  language?: string;
  now: string;
  provider?: ResearchSynthesisProvider;
}): Promise<DecisionBrief> {
  const preliminary = runAbility(input);
  const selectionGaps = preliminary.researchGaps.filter((gap) => gap !== "No evidence-backed analysis has been supplied.");
  if (!input.provider || selectionGaps.length > 0) return preliminary;
  const selected = new Set(preliminary.evidenceIds);
  const evidence = input.evidence.filter((item) => selected.has(item.id)).map((item) => ({
    id: item.id, sourceClass: item.sourceClass, externalReference: item.externalReference,
    sourceContent: item.sourceContent.slice(0, 12_000), synthesis: item.synthesis, method: item.method,
    applicability: item.applicability, confidence: item.confidence, grade: item.grade,
    observedAt: item.observedAt, publishedAt: item.publishedAt,
  }));
  const analysis = await input.provider.synthesize({
    clientId: input.clientId, abilityId: input.abilityId, question: input.question,
    market: input.market, language: input.language, evidence,
  });
  return runAbility({ ...input, analysis });
}

