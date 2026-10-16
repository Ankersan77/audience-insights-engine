import type { Applicability, SolutionProfile } from "../core/contracts.ts";
import { briefingCadence } from "./engine.ts";

export type BriefingCadence = "weekly" | "monthly" | "quarterly";
export type BriefingWindow = { start: string; end: string };
export type BriefingReference = { id: number; kind: "signal" | "decision_brief" | "campaign" | "market_twin"; status: string; evidenceIds: readonly number[] };
export type PeriodicBriefing = {
  contract: "periodic-briefing@1";
  clientId: string;
  solutionProfileId: string;
  solutionVersion: number;
  sensingProfileId?: string;
  cadence: BriefingCadence;
  window: BriefingWindow;
  generatedAt: string;
  scope: string;
  summary: string;
  outcome: "review_required" | "no_material_change" | "needs_context";
  coverage: { sourceId: number; receiptCount: number }[];
  monitoring: { id: number; outcome: string }[];
  references: BriefingReference[];
  contradictions: { recordId: number; contradictsId: number }[];
  evidenceIds: number[];
  gaps: string[];
  limitations: string[];
  nextDecision: string;
  review?: { decision: "accepted" | "rejected"; reviewerUserId: number; reviewedAt: string };
};

/** Closed UTC periods only; the first period begins at configuration activation. */
export function dueBriefingWindows(cadence: BriefingCadence, since: string, now: string, limit = 12): BriefingWindow[] {
  let start = new Date(since);
  const time = Date.parse(now);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(time) || !["weekly", "monthly", "quarterly"].includes(cadence)) throw new Error("invalid-briefing-window");
  const windows: BriefingWindow[] = [];
  for (let index = 0; index < Math.min(Math.max(limit, 0), 12); index++) {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    if (cadence === "weekly") end.setUTCDate(end.getUTCDate() + (8 - (end.getUTCDay() || 7)));
    else if (cadence === "monthly") end.setUTCMonth(end.getUTCMonth() + 1, 1);
    else end.setUTCMonth(Math.floor(end.getUTCMonth() / 3) * 3 + 3, 1);
    if (end.getTime() > time) break;
    windows.push({ start: start.toISOString(), end: end.toISOString() });
    start = end;
  }
  return windows;
}

export function briefingKey(profileId: string, cadence: BriefingCadence, window: BriefingWindow): string {
  return `briefing:${profileId}:${cadence}:${window.end}`;
}

type Scoped = { clientId: string };
type RecordInput = Scoped & { id: number; kind: string; reviewState: string; lifecycle: string; evidenceIds: readonly number[]; contradictionIds: readonly number[]; decayAt?: string; createdAt: string; applicability: Applicability };
export type BriefingInputs = {
  profile: SolutionProfile;
  cadence: BriefingCadence;
  window: BriefingWindow;
  now: string;
  sourceIds: readonly number[];
  unavailableSourceCount: number;
  receipts: readonly (Scoped & { sourceId: number; completedAt: string; status: string })[];
  runs: readonly (Scoped & { id: number; finishedAt: string; outcome: string; signalIds: readonly number[] })[];
  briefs: readonly (Scoped & { id: number; createdAt: string; status: string; abilityId: string; evidenceIds: readonly number[]; markets: readonly string[]; languages: readonly string[] })[];
  records: readonly RecordInput[];
  campaigns: readonly (Scoped & { id: number; state: string })[];
  usableEvidenceIds: ReadonlySet<number>;
};

/** A deterministic review packet, never a substitute for expert synthesis or causal analysis. */
export function buildPeriodicBriefing(input: BriefingInputs): PeriodicBriefing {
  const { profile, window } = input;
  const own = (item: Scoped) => item.clientId === profile.clientId;
  const inWindow = (date: string) => Date.parse(date) >= Date.parse(window.start) && Date.parse(date) < Date.parse(window.end);
  const supported = (ids: readonly number[]) => ids.length > 0 && ids.every((id) => input.usableEvidenceIds.has(id));
  const applies = (markets: readonly string[], languages: readonly string[]) => (!markets.length || markets.some((market) => profile.markets.includes(market))) && (!languages.length || languages.some((language) => profile.languages.includes(language)));
  const coverage = [...new Set(input.sourceIds)].map((sourceId) => ({ sourceId, receiptCount: input.receipts.filter((item) => own(item) && item.sourceId === sourceId && item.status === "succeeded" && inWindow(item.completedAt)).length }));
  const runs = input.runs.filter((item) => own(item) && inWindow(item.finishedAt));
  const records = input.records.filter((item) => own(item) && Date.parse(item.createdAt) < Date.parse(window.end) && applies(item.applicability.markets, item.applicability.languages));
  const signalIds = new Set(runs.flatMap((item) => item.signalIds));
  const current = (item: RecordInput) => ["candidate", "live"].includes(item.lifecycle) && (!item.decayAt || Date.parse(item.decayAt) > Date.parse(input.now)) && supported(item.evidenceIds);
  const signals = records.filter((item) => item.kind === "signal" && signalIds.has(item.id) && ["pending", "accepted", "revision_requested"].includes(item.reviewState) && current(item));
  const briefs = input.briefs.filter((item) => own(item) && inWindow(item.createdAt) && applies(item.markets, item.languages) && item.status === "ready" && supported(item.evidenceIds));
  const references: BriefingReference[] = signals.map((item) => ({ id: item.id, kind: "signal", status: item.reviewState, evidenceIds: item.evidenceIds }));
  const currentRecordIds = new Set(records.filter(current).map((item) => item.id));
  const contradictions = records.filter(current).flatMap((record) => record.contradictionIds.filter((id) => currentRecordIds.has(id)).map((id) => ({ recordId: record.id, contradictsId: id })));
  const contradictionRecordIds = new Set(contradictions.flatMap((item) => [item.recordId, item.contradictsId]));
  const gaps: string[] = [];
  if (!coverage.length || input.unavailableSourceCount || coverage.some((item) => item.receiptCount === 0)) gaps.push("Required source coverage is incomplete or currently unavailable.");
  if (!runs.length || runs.some((item) => !["signals_qualified", "no_material_change"].includes(item.outcome))) gaps.push("Monitoring coverage is absent, incomplete, or failed; silence is not evidence of no change.");
  if (signals.length < signalIds.size) gaps.push("Some qualified signal references are no longer usable or applicable.");
  if (input.cadence !== "weekly") {
    references.push(...briefs.map((item): BriefingReference => ({ id: item.id, kind: "decision_brief", status: item.status, evidenceIds: item.evidenceIds })));
    references.push(...input.campaigns.filter(own).map((item): BriefingReference => ({ id: item.id, kind: "campaign", status: item.state, evidenceIds: [] })));
  }
  if (input.cadence === "monthly") {
    for (const ability of ["audience-purchase-behavior", "brand-positioning-diagnosis"]) {
      if (!briefs.some((item) => item.abilityId === ability)) gaps.push(`Missing current evidence-backed ${ability} brief for this period.`);
    }
  }
  if (input.cadence === "quarterly") {
    references.push(...records.filter((item) => item.kind !== "signal").map((item): BriefingReference => ({ id: item.id, kind: "market_twin", status: !current(item) ? "stale_or_unsupported" : `${item.kind}:${item.reviewState}`, evidenceIds: current(item) ? item.evidenceIds : [] })));
    if (!records.some((item) => item.reviewState === "accepted" && item.lifecycle === "live" && current(item))) gaps.push("No current reviewed Market Twin context is supported by the configured sources.");
  }
  const outcome = gaps.length ? "needs_context" : input.cadence === "weekly" && signals.length === 0 && runs.every((item) => item.outcome === "no_material_change") ? "no_material_change" : "review_required";
  return {
    contract: "periodic-briefing@1", clientId: profile.clientId, solutionProfileId: profile.id, solutionVersion: profile.version, sensingProfileId: profile.sensingProfileId,
    cadence: input.cadence, window, generatedAt: input.now, scope: briefingCadence(input.cadence).scope, outcome,
    summary: outcome === "needs_context" ? "The period cannot support a complete research review. Resolve the listed coverage and evidence gaps."
      : outcome === "no_material_change" ? "Completed monitoring reported no material change within the configured scope. This is not a claim about the entire market."
      : `${signals.length} qualified signal(s) and ${references.length - signals.length} contextual reference(s) are assembled for human review.`,
    coverage, monitoring: runs.map((item) => ({ id: item.id, outcome: item.outcome })), references, contradictions,
    evidenceIds: [...new Set([...references.flatMap((item) => [...item.evidenceIds]), ...records.filter((item) => contradictionRecordIds.has(item.id)).flatMap((item) => [...item.evidenceIds])])], gaps,
    limitations: ["Deterministic evidence index, not model-generated expert synthesis.", "Signals remain candidates until their separate review; briefing approval does not promote Market Twin records.", "Campaign status and evidence usability are snapshots at generation, not reconstructed historical states.", "Receipt coverage demonstrates a check, not representativeness or continuous coverage. No causal inference is made."],
    nextDecision: gaps.length ? "Assign the missing research or source checks before drawing a conclusion." : "Review the linked evidence and choose the next research or campaign decision.",
  };
}
