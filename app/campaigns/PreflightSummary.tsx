import type { CampaignAssessment } from "@/src/campaigns/analysis";
import type { ContextualPreflight } from "@/src/campaigns/preflight";

export function PreflightSummary({ assessment }: { assessment?: CampaignAssessment }) {
  const assessed = assessment as ContextualPreflight | undefined;
  if (assessed?.method !== "analyst-preflight@1") return null;
  return <details className="mt-4 rounded-md border border-border p-3 text-sm">
    <summary>Analyst pre-flight reasoning and frozen context</summary>
    <p className="mt-2 text-xs text-muted">Campaign revision {assessed.campaignSnapshot.revision}; measurement version {assessed.measurementSnapshot?.version ?? "missing"}; solution version {assessed.contextBasis?.solutionVersion ?? "missing"}; scope {assessed.contextBasis?.market} / {assessed.contextBasis?.language}. Historical snapshot, not a claim of perpetual freshness.</p>
    <p className="mt-2">Alternative: {assessed.review?.alternative ?? "Not assessed"}</p>
    <p className="mt-2">What would change this conclusion: {assessed.review?.wouldChangeConclusion ?? "Not assessed"}</p>
    {assessed.review?.findings.map((finding) => <div key={finding.dimension} className="mt-3">
      <strong>{finding.dimension.replaceAll("_", " ")} · {finding.verdict}</strong>
      <p>{finding.rationale}</p>
      <p className="text-xs text-muted">Evidence: {finding.evidenceIds.join(", ") || "missing"}; Market Twin: {finding.intelligenceIds.join(", ") || "missing"}</p>
    </div>)}
    {assessed.review?.contradictionResponse ? <p className="mt-3">Contradiction rationale: {assessed.review.contradictionResponse}</p> : null}
    {assessed.watchouts.length ? <ul className="mt-3 list-disc pl-5">{assessed.watchouts.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
    <a href="/workspace" className="mt-3 inline-block underline">Inspect source evidence and Market Twin</a>
  </details>;
}
