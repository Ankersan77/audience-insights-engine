"use client";

import { useState } from "react";
import type { Campaign } from "@/src/core/contracts";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { CampaignWorkspaceRow, StudyWorkspaceRow } from "@/src/db/queries/campaign_workspace";
import type { IntelligenceListRow } from "@/src/db/queries/workspace_intelligence";

function commaList(value: FormDataEntryValue | null): string[] {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

const NEXT_STATE: Partial<Record<Campaign["state"], Campaign["state"]>> = { proposed: "approved", approved: "active", active: "completed", completed: "learning_reviewed" };

function metricMap(value: FormDataEntryValue | null): Record<string, number> {
  if (typeof value !== "string") return {};
  return Object.fromEntries(value.split(",").map((item) => item.trim().split("=")).filter(([key, amount]) => key && amount && Number.isFinite(Number(amount))).map(([key, amount]) => [key, Number(amount)]));
}

export function CampaignWorkspace({ initialCampaigns, evidence, initialStudies, intelligence, canResearch, canReview }: { initialCampaigns: CampaignWorkspaceRow[]; evidence: CanonicalEvidenceListRow[]; initialStudies: StudyWorkspaceRow[]; intelligence: IntelligenceListRow[]; canResearch: boolean; canReview: boolean }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [studies, setStudies] = useState(initialStudies);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultEvidence, setResultEvidence] = useState<Record<number, number[]>>({});

  async function refresh() {
    const campaignsResponse = await fetch("/api/campaigns");
    setCampaigns((await campaignsResponse.json()).campaigns ?? []);
    window.location.reload();
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const data = new FormData(event.currentTarget);
    const response = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      name: data.get("name"), objective: data.get("objective"), audience: data.get("audience"), proposition: data.get("proposition"),
      creativeRoutes: commaList(data.get("creativeRoutes")), channels: commaList(data.get("channels")), budgetAssumptions: commaList(data.get("budgetAssumptions")),
      brandConstraints: commaList(data.get("brandConstraints")), strategicEvidenceIds: selectedEvidence,
    }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Campaign could not be created."); return; }
    setCreateOpen(false); setSelectedEvidence([]); await refresh();
  }

  async function createPlan(event: React.FormEvent<HTMLFormElement>, campaignId: number) {
    event.preventDefault(); setError(null); const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/campaigns/${campaignId}/measurement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      objective: data.get("objective"), hypothesis: data.get("hypothesis"), population: data.get("population"), metricKey: data.get("metricKey"), metricLabel: data.get("metricLabel"), unit: data.get("unit"), direction: data.get("direction"), aggregation: data.get("aggregation"), baseline: data.get("baseline"), target: data.get("target"), materiality: data.get("materiality"), checkpoints: commaList(data.get("checkpoints")), exposureDefinition: data.get("exposureDefinition"), attributionAssumptions: commaList(data.get("attributionAssumptions")), incrementalityDesign: data.get("incrementalityDesign"), decisionRules: commaList(data.get("decisionRules")),
    }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Measurement plan could not be created."); return; } await refresh();
  }

  async function transition(campaignId: number, nextState: Campaign["state"], learningRecordId?: number) {
    const response = await fetch(`/api/campaigns/${campaignId}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nextState, learningRecordId }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Transition failed."); return; } await refresh();
  }

  async function reviewPlan(campaignId: number, decision: "accepted" | "revision_requested" | "rejected") {
    const response = await fetch(`/api/campaigns/${campaignId}/measurement/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Plan review failed."); return; } await refresh();
  }

  async function createStudy(event: React.FormEvent<HTMLFormElement>, campaignId: number) {
    event.preventDefault(); setError(null); const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/campaigns/${campaignId}/study`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      requestedClaim: data.get("requestedClaim"), hasTreatmentGroup: data.get("hasTreatmentGroup") === "on", hasControlGroup: data.get("hasControlGroup") === "on", assignment: data.get("assignment"), baselineMeasured: data.get("baselineMeasured") === "on", outcomeInstrument: data.get("outcomeInstrument"), sampleSizeTreatment: data.get("sampleSizeTreatment"), sampleSizeControl: data.get("sampleSizeControl"), weighting: data.get("weighting"), fieldworkStart: data.get("fieldworkStart"), fieldworkEnd: data.get("fieldworkEnd"), preregistered: data.get("preregistered") === "on", contaminationRisk: data.get("contaminationRisk"), exclusions: commaList(data.get("exclusions")),
    }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Study could not be created."); return; }
    setStudies((current) => [payload.study, ...current]);
  }

  async function reviewStudy(campaignId: number, studyId: number, decision: "accepted" | "revision_requested" | "rejected") {
    const response = await fetch(`/api/campaigns/${campaignId}/study/${studyId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Study review failed."); return; } await refresh();
  }

  async function createAssessment(event: React.FormEvent<HTMLFormElement>, campaignId: number, stage: "preflight" | "live" | "post") {
    event.preventDefault(); setError(null); const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/campaigns/${campaignId}/assessment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      stage,
      baseline: metricMap(data.get("baseline")), current: metricMap(data.get("current")), observedResults: metricMap(data.get("observedResults")),
      anomalies: commaList(data.get("anomalies")), contextualChanges: commaList(data.get("contextualChanges")), dataQualityIssues: commaList(data.get("dataQualityIssues")), alternativeExplanations: commaList(data.get("alternativeExplanations")),
      resultEvidenceIds: resultEvidence[campaignId] ?? [],
    }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Assessment failed."); return; } await refresh();
  }

  async function createLearning(campaignId: number, assessmentId: number) {
    const response = await fetch(`/api/campaigns/${campaignId}/learning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assessmentId }) });
    const payload = await response.json(); if (!response.ok) { setError(payload.error ?? "Learning candidate failed."); return; } window.location.reload();
  }

  return <div className="flex flex-col gap-6">
    {canResearch ? <div><button onClick={() => setCreateOpen((value) => !value)} className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)]">{createOpen ? "Cancel" : "Create campaign"}</button></div> : null}
    {createOpen ? <form onSubmit={createCampaign} className="grid gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-2">
      {(["name", "objective", "audience", "proposition"] as const).map((name) => <label key={name} className="flex flex-col gap-1 text-sm font-medium capitalize">{name}<input required name={name} className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>)}
      {(["creativeRoutes", "channels", "budgetAssumptions", "brandConstraints"] as const).map((name) => <label key={name} className="flex flex-col gap-1 text-sm font-medium">{name.replace(/([A-Z])/g, " $1")}<input name={name} placeholder="Comma-separated" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>)}
      <fieldset className="rounded-md border border-border p-3 md:col-span-2"><legend className="px-1 text-sm font-medium">Strategic evidence</legend><div className="grid gap-2 md:grid-cols-2">{evidence.map((item) => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={() => setSelectedEvidence((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />{item.synthesis ?? item.externalReference}</label>)}</div></fieldset>
      <button className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-2">Create proposed campaign</button>
    </form> : null}
    {error ? <p className="rounded-md bg-[var(--status-danger-bg)] p-3 text-sm text-[var(--status-danger-text)]">{error}</p> : null}
    {campaigns.map((row) => { const campaign = row.payload.campaign; const nextState = NEXT_STATE[row.state]; const campaignStudies = studies.filter((item) => item.campaignId === row.id); const acceptedLearnings = intelligence.filter((item) => item.kind === "learning" && item.reviewState === "accepted" && item.applicability.campaigns.includes(String(row.id))); return <article key={row.id} className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted uppercase">Revision {row.currentRevision}</p><h2 className="text-lg font-semibold">{campaign.name}</h2><p className="mt-1 text-sm text-muted">{campaign.objective}</p></div><span className="rounded-full bg-[var(--status-info-bg)] px-2 py-1 text-xs text-[var(--status-info-text)]">{row.state}</span></div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3"><div><dt className="font-medium">Audience</dt><dd className="text-muted">{campaign.audience}</dd></div><div><dt className="font-medium">Proposition</dt><dd className="text-muted">{campaign.proposition}</dd></div><div><dt className="font-medium">Evidence</dt><dd className="text-muted">{row.payload.strategicEvidenceIds.length} linked item(s)</dd></div></dl>
      {!row.measurementPlan && canResearch ? <form onSubmit={(event) => void createPlan(event, row.id)} className="mt-5 grid gap-3 rounded-md border border-border p-4 md:grid-cols-3"><h3 className="font-medium md:col-span-3">Measurement plan required before approval</h3>
        {(["objective", "hypothesis", "population", "metricKey", "metricLabel", "unit", "baseline", "target", "materiality", "checkpoints", "exposureDefinition", "attributionAssumptions", "incrementalityDesign", "decisionRules"] as const).map((name) => <label key={name} className="flex flex-col gap-1 text-xs font-medium">{name.replace(/([A-Z])/g, " $1")}<input required={["objective","hypothesis","population","metricKey","unit","baseline","target","materiality"].includes(name)} name={name} type={["baseline","target","materiality"].includes(name) ? "number" : "text"} step="any" className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label>)}
        <label className="flex flex-col gap-1 text-xs font-medium">Direction<select name="direction" className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"><option>increase</option><option>decrease</option><option>target</option></select></label><label className="flex flex-col gap-1 text-xs font-medium">Aggregation<select name="aggregation" className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"><option>rate</option><option>count</option><option>mean</option><option>index</option><option>sum</option></select></label>
        <button className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-3">Save measurement plan</button>
      </form> : null}
      {row.measurementPlan ? <div className="mt-5 rounded-md border border-border p-4"><div className="flex justify-between gap-3"><h3 className="font-medium">Measurement plan</h3><span className="text-xs text-muted">{row.measurementPlanReviewState}</span></div><p className="mt-1 text-sm text-muted">{row.measurementPlan.hypothesis}</p><p className="mt-2 text-xs text-muted">Metrics: {row.measurementPlan.metrics.map((metric) => metric.label).join(", ")}</p>{canReview && row.measurementPlanReviewState === "pending" ? <div className="mt-3 flex gap-2"><button onClick={() => void reviewPlan(row.id, "accepted")} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--button-primary-text)]">Accept plan</button><button onClick={() => void reviewPlan(row.id, "revision_requested")} className="rounded-md border border-border px-3 py-1.5 text-xs">Request revision</button><button onClick={() => void reviewPlan(row.id, "rejected")} className="rounded-md border border-border px-3 py-1.5 text-xs text-[var(--status-danger-text)]">Reject</button></div> : null}</div> : null}
      {canResearch && row.state === "proposed" ? <form onSubmit={(event) => void createAssessment(event, row.id, "preflight")} className="mt-5 rounded-md border border-border p-4"><h3 className="font-medium">Pre-flight assessment</h3><p className="mt-1 text-xs text-muted">Checks strategic evidence, campaign logic, brand constraints and measurement readiness.</p><button className="mt-3 rounded-md border border-border px-3 py-2 text-sm">Run and save pre-flight</button></form> : null}
      {canResearch && row.state === "active" ? <form onSubmit={(event) => void createAssessment(event, row.id, "live")} className="mt-5 grid gap-3 rounded-md border border-border p-4 md:grid-cols-2"><h3 className="font-medium md:col-span-2">Live descriptive assessment</h3><label className="text-xs font-medium">Baseline metrics<input required name="baseline" placeholder="awareness=40, consideration=25" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-medium">Current metrics<input required name="current" placeholder="awareness=43, consideration=27" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-medium">Anomalies<input name="anomalies" placeholder="Comma-separated" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-medium">Context changes<input name="contextualChanges" placeholder="Comma-separated" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><button className="rounded-md border border-border px-3 py-2 text-sm md:col-span-2">Save live assessment</button></form> : null}
      {canResearch && row.state === "completed" ? <form onSubmit={(event) => void createAssessment(event, row.id, "post")} className="mt-5 grid gap-3 rounded-md border border-border p-4 md:grid-cols-2"><h3 className="font-medium md:col-span-2">Post-campaign readback</h3><label className="text-xs font-medium">Observed planned metrics<input required name="observedResults" placeholder="awareness=46, consideration=29" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-medium">Data-quality issues<input name="dataQualityIssues" placeholder="Comma-separated" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-medium md:col-span-2">Alternative explanations<input name="alternativeExplanations" placeholder="Competitor campaign, seasonality" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label><fieldset className="rounded-md border border-border p-3 md:col-span-2"><legend className="px-1 text-xs font-medium">Aggregate result evidence</legend><div className="grid gap-2 md:grid-cols-2">{evidence.map((item) => <label key={item.id} className="flex gap-2 text-xs"><input type="checkbox" checked={(resultEvidence[row.id] ?? []).includes(item.id)} onChange={() => setResultEvidence((current) => ({ ...current, [row.id]: (current[row.id] ?? []).includes(item.id) ? (current[row.id] ?? []).filter((id) => id !== item.id) : [...(current[row.id] ?? []), item.id] }))} />{item.synthesis ?? item.externalReference}</label>)}</div></fieldset><button className="rounded-md border border-border px-3 py-2 text-sm md:col-span-2">Save post assessment</button></form> : null}
      <div className="mt-4 grid gap-2">{(["preflight", "live", "post"] as const).map((stage) => { const artifact = row.latestAssessments[stage]; return artifact ? <div key={stage} className="rounded-md border border-border p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{stage} · v{artifact.version}</span><span className="text-xs text-muted">{artifact.assessment.status}</span></div><p className="mt-1 text-muted">{artifact.assessment.pointOfView}</p>{artifact.assessment.researchGaps.length ? <ul className="mt-2 list-disc pl-5 text-xs text-[var(--status-warning-text)]">{artifact.assessment.researchGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}{stage === "post" && artifact.assessment.candidateLearning && canResearch ? <button onClick={() => void createLearning(row.id, artifact.id)} className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs">Create governed learning candidate</button> : null}</div> : null; })}</div>
      {nextState && nextState !== "learning_reviewed" && (nextState === "approved" ? canReview : canResearch) ? <button onClick={() => void transition(row.id, nextState)} className="mt-4 rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]">Move to {nextState}</button> : null}
      {nextState === "learning_reviewed" && canReview ? <div className="mt-4 flex flex-wrap items-end gap-2"><label className="flex flex-col gap-1 text-xs font-medium">Accepted campaign learning<select id={`learning-${row.id}`} className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"><option value="">Select learning</option>{acceptedLearnings.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button onClick={() => { const value = Number((document.getElementById(`learning-${row.id}`) as HTMLSelectElement | null)?.value); if (value) void transition(row.id, "learning_reviewed", value); else setError("Select an accepted learning first."); }} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]">Mark learning reviewed</button></div> : null}
      {canResearch && row.state !== "archived" ? <button onClick={() => void transition(row.id, "archived")} className="mt-4 ml-2 rounded-md border border-border px-3 py-2 text-sm">Archive</button> : null}
      {row.measurementPlan && canResearch ? <form onSubmit={(event) => void createStudy(event, row.id)} className="mt-5 grid gap-3 rounded-md border border-border p-4 md:grid-cols-3"><h3 className="font-medium md:col-span-3">Classify study design</h3>
        <label className="flex flex-col gap-1 text-xs font-medium">Requested claim<select name="requestedClaim" className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"><option value="diagnostic">Diagnostic</option><option value="directional">Directional</option><option value="brand_lift">Brand Lift</option></select></label><label className="flex flex-col gap-1 text-xs font-medium">Assignment<select name="assignment" className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"><option value="none">None</option><option value="observational">Observational</option><option value="matched">Matched</option><option value="randomized">Randomized</option></select></label><label className="flex flex-col gap-1 text-xs font-medium">Contamination risk<select name="contaminationRisk" className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"><option>unknown</option><option>low</option><option>medium</option><option>high</option></select></label>
        {(["outcomeInstrument", "sampleSizeTreatment", "sampleSizeControl", "weighting", "fieldworkStart", "fieldworkEnd", "exclusions"] as const).map((name) => <label key={name} className="flex flex-col gap-1 text-xs font-medium">{name.replace(/([A-Z])/g, " $1")}<input required={name === "outcomeInstrument"} name={name} type={name.includes("Size") ? "number" : name.includes("fieldwork") ? "date" : "text"} className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" /></label>)}
        <div className="flex flex-wrap gap-4 text-sm md:col-span-3">{(["hasTreatmentGroup","hasControlGroup","baselineMeasured","preregistered"] as const).map((name) => <label key={name} className="flex items-center gap-2"><input name={name} type="checkbox" />{name.replace(/([A-Z])/g, " $1")}</label>)}</div><button className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-3">Classify and save study</button>
      </form> : null}
      {campaignStudies.map((item) => <div key={item.id} className="mt-3 rounded-md border border-border p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{item.design.requestedClaim.replaceAll("_", " ")}</span><span className={item.classificationResult.mayUseBrandLiftTerm ? "text-[var(--status-success-text)]" : "text-[var(--status-warning-text)]"}>{item.classification} · {item.reviewState}</span></div><p className="mt-1 text-muted">{item.classificationResult.strongestAllowedClaim}</p>{item.classificationResult.missingRequirements.length ? <ul className="mt-2 list-disc pl-5 text-xs text-[var(--status-warning-text)]">{item.classificationResult.missingRequirements.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}{canReview && item.reviewState === "pending" ? <div className="mt-3 flex gap-2"><button onClick={() => void reviewStudy(row.id, item.id, "accepted")} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-1.5 text-xs text-[var(--button-primary-text)]">Accept method</button><button onClick={() => void reviewStudy(row.id, item.id, "revision_requested")} className="rounded-md border border-border px-3 py-1.5 text-xs">Request revision</button><button onClick={() => void reviewStudy(row.id, item.id, "rejected")} className="rounded-md border border-border px-3 py-1.5 text-xs">Reject</button></div> : null}</div>)}
    </article>; })}
    {campaigns.length === 0 ? <p className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">No campaigns yet.</p> : null}
  </div>;
}

