import type { SensingProfile } from "../core/contracts.ts";

export type SignalCandidate = {
  id: string;
  clientId: string;
  theme: string;
  currentValue: number;
  baselineValue: number;
  confidence: number;
  observedAt: string;
  sourceIds: readonly string[];
  duplicateOf?: string;
  botRisk: number;
  manipulationRisk: number;
  sampleSize: number;
  seasonalExpectation?: number;
};

export type SignalQualification = {
  signalId: string;
  qualified: boolean;
  materiality: number;
  reasons: readonly string[];
};

export type MonitoringOutcome = {
  outcome: "signals_qualified" | "no_material_change" | "source_health_failure";
  qualifications: readonly SignalQualification[];
  briefingType?: "urgent" | "weekly" | "monthly" | "quarterly";
  message: string;
};

function inQuietPeriod(profile: SensingProfile, now: string): boolean {
  const time = new Date(now).getTime();
  return profile.quietPeriods.some((period) =>
    new Date(period.start).getTime() <= time && time <= new Date(period.end).getTime(),
  );
}

export function qualifySignals(input: {
  profile: SensingProfile;
  candidates: readonly SignalCandidate[];
  now: string;
  sourceHealthOk: boolean;
}): MonitoringOutcome {
  if (!input.sourceHealthOk) {
    return { outcome: "source_health_failure", qualifications: [], message: "One or more required sources did not produce a trustworthy receipt." };
  }

  const now = new Date(input.now).getTime();
  const qualifications = input.candidates.map((candidate): SignalQualification => {
    const reasons: string[] = [];
    if (candidate.clientId !== input.profile.clientId) reasons.push("different-client");
    if (!input.profile.themes.includes(candidate.theme)) reasons.push("theme-out-of-scope");
    if (candidate.duplicateOf) reasons.push("duplicate");
    if (candidate.sourceIds.length < input.profile.minimumCorroboration) reasons.push("insufficient-corroboration");
    if (candidate.confidence < input.profile.confidenceThreshold) reasons.push("low-confidence");
    if (candidate.botRisk >= 0.5) reasons.push("bot-heavy");
    if (candidate.manipulationRisk >= 0.5) reasons.push("manipulation-risk");
    if (candidate.sampleSize < 10) reasons.push("low-sample");
    const ageDays = (now - new Date(candidate.observedAt).getTime()) / 86_400_000;
    if (ageDays > input.profile.freshnessDays) reasons.push("stale");
    const baseline = candidate.seasonalExpectation ?? candidate.baselineValue;
    const materiality = baseline === 0 ? Math.abs(candidate.currentValue) : Math.abs((candidate.currentValue - baseline) / baseline);
    if (materiality < input.profile.materialityThreshold) reasons.push("below-materiality");
    return { signalId: candidate.id, qualified: reasons.length === 0, materiality, reasons };
  });

  const qualified = qualifications.filter((item) => item.qualified);
  if (qualified.length === 0) {
    return { outcome: "no_material_change", qualifications, message: "Sources were checked; no signal passed scope, quality, freshness, corroboration, and materiality gates." };
  }
  const urgent = qualified.some((item) => item.materiality >= input.profile.materialityThreshold * 2);
  return {
    outcome: "signals_qualified",
    qualifications,
    briefingType: urgent && !inQuietPeriod(input.profile, input.now) ? "urgent" : "weekly",
    message: `${qualified.length} signal(s) require human review; no learning or external action was performed.`,
  };
}

export function briefingCadence(kind: "weekly" | "monthly" | "quarterly"): { scope: string; includes: readonly string[] } {
  if (kind === "weekly") return { scope: "market and competitor pulse", includes: ["qualified signals", "source health", "contradictions"] };
  if (kind === "monthly") return { scope: "audience, positioning and campaign review", includes: ["decision briefs", "campaign checkpoints", "research gaps"] };
  return { scope: "Market Twin health and research-gap review", includes: ["stale records", "candidate learnings", "decay", "priority research backlog"] };
}
