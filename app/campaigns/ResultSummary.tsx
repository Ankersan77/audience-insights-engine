import type { CampaignAssessment } from "@/src/campaigns/analysis";
import type { CampaignResultAssessment } from "@/src/campaigns/results";

export function ResultSummary({ assessment }: { assessment: CampaignAssessment }) {
  const result = assessment as CampaignResultAssessment;
  if (result.method !== "source-backed-readback@1") return null;
  return <details className="mt-3 rounded-md border border-border p-3">
    <summary>Source-backed metrics and frozen assessment basis</summary>
    <p className="mt-2 text-xs text-muted">Campaign revision {result.campaignSnapshot.revision}; plan version {result.measurementSnapshot.version}; Market Twin solution version {result.contextBasis?.solutionVersion ?? "missing"}. Historical snapshot, not a current availability guarantee.</p>
    {result.comparisons.map((item) => <div key={item.metricKey} className="mt-3 text-sm">
      <strong>{item.metricKey}</strong>
      {item.expired ? <p>Values unavailable under current source rights or retention policy. Evidence lineage: {item.baselineEvidenceId} / {item.resultEvidenceId}.</p> : <>
        <p>{item.baseline} → {item.result} {item.unit}; difference {item.delta}. Target {item.target}: {item.targetMet ? "met" : "not met"}. Material change: {item.materialChange ? "yes" : "no"}.</p>
        <p className="text-xs text-muted">{item.population} · {item.aggregation}; baseline {item.baselineWindow?.join(" – ")}; result {item.resultWindow?.join(" – ")}.</p>
        <p className="text-xs">Observations #{item.baselineObservationId} / #{item.resultObservationId}; evidence #{item.baselineEvidenceId} / #{item.resultEvidenceId}.</p>
        {item.limitations?.map((limitation) => <p key={limitation} className="text-xs text-muted">{limitation}</p>)}
      </>}
    </div>)}
    <p className="mt-3 text-xs text-muted">These differences do not establish attribution, incrementality or a transferable campaign learning.</p>
  </details>;
}
