"use client";

import { useState } from "react";
import type { PeriodicBriefingRow } from "@/src/db/queries/briefings";
import type { BriefingCadence, BriefingReference } from "@/src/monitoring/briefings";

function referenceLink(item: BriefingReference): string {
  if (item.kind === "campaign") return "/campaigns";
  if (item.kind === "decision_brief") return `/workspace#brief-${item.id}`;
  return "/workspace";
}

export function BriefingWorkspace({ initialBriefings, configuration, canAdminister, canReview }: {
  initialBriefings: PeriodicBriefingRow[];
  configuration: { id: string; cadences: readonly BriefingCadence[] } | null;
  canAdminister: boolean;
  canReview: boolean;
}) {
  const [briefings, setBriefings] = useState(initialBriefings);
  const [cadences, setCadences] = useState<readonly BriefingCadence[]>(configuration?.cadences ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mutate(url: string, body: unknown, reload = false) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? "The request could not be completed."); return; }
      if (reload) { window.location.reload(); return; }
      const refreshed = await fetch("/api/monitoring/briefings");
      if (!refreshed.ok) throw new Error("refresh-failed");
      setBriefings((await refreshed.json()).briefings);
    } catch { setError("The request could not be confirmed. Refresh before trying again."); }
    finally { setBusy(false); }
  }

  return <section className="mt-6 rounded-lg border border-border bg-surface p-5">
    <h2 className="text-lg font-semibold">Scheduled research reviews</h2>
    <p className="mt-1 text-sm text-muted">Evidence indexes for closed UTC periods. These packets support a human research review; they are not autonomous expert conclusions.</p>
    {canAdminister && configuration ? <form className="mt-4 rounded border border-border p-3" onSubmit={(event) => { event.preventDefault(); void mutate("/api/monitoring/briefings/settings", { profileId: configuration.id, cadences }, true); }}>
      <fieldset disabled={busy}><legend className="text-sm font-medium">Briefing rhythms</legend>
        <div className="mt-2 flex flex-wrap gap-4">{(["weekly", "monthly", "quarterly"] as const).map((cadence) => <label key={cadence} className="flex gap-2 text-sm"><input type="checkbox" checked={cadences.includes(cadence)} onChange={() => setCadences((current) => current.includes(cadence) ? current.filter((item) => item !== cadence) : [...current, cadence])} />{cadence}</label>)}</div>
        <p className="mt-2 text-xs text-muted">Requires a bound sensing profile. Saving creates a new solution version; its first partial period begins at activation. No external delivery or provider spend is enabled.</p>
        <button className="mt-3 rounded border border-border px-3 py-2 text-sm">Save briefing rhythms</button>
      </fieldset>
    </form> : null}
    {!configuration ? <p className="mt-3 text-sm text-muted">Configure an active solution and sensing profile before enabling scheduled reviews.</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--status-danger-text)]">{error}</p> : null}
    <div className="mt-4 grid gap-4">{briefings.map(({ id, status, briefing, currentEvidenceAvailable }) => <article key={id} className="rounded border border-border p-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{briefing.cadence} · {briefing.scope}</h3><span className="text-xs text-muted">{status} · {briefing.outcome}</span></div>
      <p className="mt-1 text-xs text-muted">{briefing.window.start} → {briefing.window.end} (end exclusive) · solution v{briefing.solutionVersion}</p>
      <p className="mt-3 text-sm">{briefing.summary}</p>
      {!currentEvidenceAvailable ? <p className="mt-2 text-sm text-[var(--status-warning-text)]">Some referenced sources or evidence are no longer available. A historical approval does not establish current validity.</p> : null}
      {briefing.gaps.length ? <ul className="mt-3 list-disc pl-5 text-sm">{briefing.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}
      <p className="mt-3 text-sm font-medium">Next decision: {briefing.nextDecision}</p>
      <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Coverage, evidence and limitations</summary>
        <p className="mt-2 text-muted">Generated {briefing.generatedAt}. Sensing profile {briefing.sensingProfileId}. No original excerpts are copied into this packet.</p>
        <ul className="mt-2 list-disc pl-5">{briefing.coverage.map((source) => <li key={source.sourceId}>Source {source.sourceId}: {source.receiptCount} successful receipt(s) in this period</li>)}</ul>
        <ul className="mt-2 list-disc pl-5">{briefing.monitoring.map((run) => <li key={run.id}>Monitoring run {run.id}: {run.outcome}</li>)}</ul>
        <ul className="mt-2 grid gap-1">{briefing.references.map((item) => <li key={`${item.kind}:${item.id}`}><a href={referenceLink(item)} className="underline">{item.kind} #{item.id}</a> · {item.status} · evidence {item.evidenceIds.join(", ") || "not used for a claim"}</li>)}</ul>
        <ul className="mt-2 list-disc pl-5">{briefing.contradictions.map((item) => <li key={`${item.recordId}:${item.contradictsId}`}>Market Twin record {item.recordId} contradicts record {item.contradictsId}; the packet does not select a winner.</li>)}</ul>
        <ul className="mt-2 list-disc pl-5 text-muted">{briefing.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
      {canReview && status === "pending_review" ? <div className="mt-3 flex gap-2">
        {briefing.outcome !== "needs_context" && currentEvidenceAvailable ? <button disabled={busy} onClick={() => void mutate(`/api/monitoring/briefings/${id}/review`, { decision: "accepted" })} className="rounded border border-border px-3 py-2 text-sm">Accept review packet</button> : null}
        <button disabled={busy} onClick={() => void mutate(`/api/monitoring/briefings/${id}/review`, { decision: "rejected" })} className="rounded border border-border px-3 py-2 text-sm">Reject</button>
      </div> : null}
      {briefing.review ? <p className="mt-3 text-xs text-muted">{briefing.review.decision} by reviewer {briefing.review.reviewerUserId} at {briefing.review.reviewedAt}. No signal or learning was promoted.</p> : null}
    </article>)}</div>
    {!briefings.length ? <p className="mt-4 text-sm text-muted">No completed-period review packets yet.</p> : null}
  </section>;
}
