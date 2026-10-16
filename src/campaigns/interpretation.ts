import { assertPeopleBlind, hasPromptInjection, redactIdentifiers } from "../evidence/policy.ts";

export type CampaignInterpretation = {
  observation: string; hypothesis: string; insight: string; recommendation: string;
  clientRelevance: string; alternativeExplanations: string; wouldChangeConclusion: string;
  conditions: string; learningStatement?: string; confidence: number;
  evidenceIds: string[]; intelligenceIds: string[]; metricKeys: string[];
};

/** Human-authored proposals: references are validated separately, substantive validity requires review. */
export function parseCampaignInterpretation(value: unknown): CampaignInterpretation | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-campaign-interpretation");
  const row = value as Record<string, unknown>;
  const text = (key: string) => {
    const value = row[key];
    if (typeof value !== "string" || !value.trim() || value.length > 4000 || hasPromptInjection(value)) throw new Error("invalid-campaign-interpretation");
    return redactIdentifiers(value.trim()).content;
  };
  const refs = (key: string) => {
    const value = row[key];
    if (!Array.isArray(value) || !value.length || value.length > 100 || value.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)) throw new Error("invalid-interpretation-references");
    return [...new Set(value as string[])];
  };
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) throw new Error("invalid-interpretation-confidence");
  const review: CampaignInterpretation = {
    observation: text("observation"), hypothesis: text("hypothesis"), insight: text("insight"), recommendation: text("recommendation"),
    clientRelevance: text("clientRelevance"), alternativeExplanations: text("alternativeExplanations"), wouldChangeConclusion: text("wouldChangeConclusion"), conditions: text("conditions"),
    ...(row.learningStatement ? { learningStatement: text("learningStatement") } : {}), confidence: row.confidence,
    evidenceIds: refs("evidenceIds"), intelligenceIds: refs("intelligenceIds"), metricKeys: refs("metricKeys"),
  };
  assertPeopleBlind(review);
  return review;
}

export function interpretationGaps(review: CampaignInterpretation, input: {
  evidenceIds: ReadonlySet<string>; intelligenceIds: ReadonlySet<string>; metricKeys: ReadonlySet<string>; stage: "live" | "post";
}): string[] {
  const gaps: string[] = [];
  if (review.evidenceIds.some((id) => !input.evidenceIds.has(id))) gaps.push("Interpretation cites unavailable or inapplicable evidence.");
  if (review.intelligenceIds.some((id) => !input.intelligenceIds.has(id))) gaps.push("Interpretation cites unavailable or unreviewed Market Twin knowledge.");
  if (review.metricKeys.some((key) => !input.metricKeys.has(key))) gaps.push("Interpretation requires successfully reconciled metric references.");
  if (input.stage === "live" && review.learningStatement) gaps.push("Interim interpretation cannot create a completed-campaign learning.");
  // This conservative tripwire is not a semantic truth checker; a named reviewer remains necessary.
  const claims = [review.observation, review.insight, review.learningStatement].filter(Boolean).join(" ");
  if (/\b(caused|drove|resulted in|incremental lift|causal effect|forårsagede|bevist effekt|dokumenteret brand lift)\b/i.test(claims)) gaps.push("Descriptive campaign interpretation cannot establish causal effect; use a reviewed study for causal claims.");
  return gaps;
}
