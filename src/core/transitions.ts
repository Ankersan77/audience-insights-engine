import type { CampaignState, IntelligenceKind, IntelligenceRecord, ReviewState } from "./contracts.ts";

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

const INTELLIGENCE_TRANSITIONS: Readonly<Record<IntelligenceKind, readonly IntelligenceKind[]>> = {
  observation: ["signal", "fact", "hypothesis", "knowledge_gap"],
  signal: ["fact", "hypothesis", "insight", "knowledge_gap"],
  fact: ["insight", "recommendation", "knowledge_gap"],
  hypothesis: ["insight", "knowledge_gap"],
  insight: ["recommendation", "decision", "knowledge_gap"],
  recommendation: ["decision", "knowledge_gap"],
  decision: ["learning", "knowledge_gap"],
  learning: ["knowledge_gap"],
  knowledge_gap: ["observation", "hypothesis"],
};

export function promoteIntelligence(
  source: IntelligenceRecord,
  targetKind: IntelligenceKind,
  input: { id: string; evidenceIds: readonly string[]; reviewState: ReviewState; now: string },
): IntelligenceRecord {
  if (!INTELLIGENCE_TRANSITIONS[source.kind].includes(targetKind)) {
    throw new TransitionError(`${source.kind} cannot transition directly to ${targetKind}`);
  }
  if (["fact", "insight", "recommendation", "learning"].includes(targetKind) && input.evidenceIds.length === 0) {
    throw new TransitionError(`${targetKind} requires evidence`);
  }
  if (targetKind === "learning" && input.reviewState !== "accepted") {
    throw new TransitionError("learning requires an accepted human review");
  }

  return {
    ...source,
    id: input.id,
    kind: targetKind,
    lifecycle: input.reviewState === "accepted" ? "live" : "candidate",
    reviewState: input.reviewState,
    evidenceIds: input.evidenceIds,
    dependencyIds: [...source.dependencyIds, source.id],
    createdAt: input.now,
    reviewedAt: input.reviewState === "accepted" ? input.now : undefined,
  };
}

const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignState, readonly CampaignState[]>> = {
  proposed: ["approved", "archived"],
  approved: ["active", "archived"],
  active: ["completed", "archived"],
  completed: ["learning_reviewed", "archived"],
  learning_reviewed: ["archived"],
  archived: [],
};

export function assertCampaignTransition(from: CampaignState, to: CampaignState): void {
  if (!CAMPAIGN_TRANSITIONS[from].includes(to)) {
    throw new TransitionError(`campaign cannot transition from ${from} to ${to}`);
  }
}
