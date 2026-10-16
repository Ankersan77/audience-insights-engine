"use client";

import { useState } from "react";
import type { AbilityManifest } from "@/src/core/contracts";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { DecisionBriefArtifact } from "@/src/db/queries/workspace_intelligence";

function commaList(value: FormDataEntryValue | null): string[] {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

export function DecisionBriefs({ abilities, evidence, initialBriefs, canResearch }: { abilities: readonly AbilityManifest[]; evidence: CanonicalEvidenceListRow[]; initialBriefs: DecisionBriefArtifact[]; canResearch: boolean }) {
  const [briefs, setBriefs] = useState(initialBriefs);
  const [open, setOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/workspace/briefs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        abilityId: data.get("abilityId"), question: data.get("question"), market: data.get("market"), language: data.get("language"),
        pointOfView: data.get("pointOfView"), clientRelevance: data.get("clientRelevance"), recommendation: data.get("recommendation"),
        nextDecision: data.get("nextDecision"), claimMode: data.get("claimMode"), evidenceIds: selectedEvidence,
        contradictions: commaList(data.get("contradictions")), uncertainty: commaList(data.get("uncertainty")),
      }),
    });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Brief could not be created."); return; }
    const refreshed = await fetch("/api/workspace/briefs");
    setBriefs((await refreshed.json()).briefs ?? []);
    setSelectedEvidence([]);
    setOpen(false);
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Decision briefs</h2><p className="mt-1 text-sm text-muted">Abilities return evidence-backed briefs or explicit research gaps.</p></div>{canResearch ? <button onClick={() => setOpen((value) => !value)} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]">{open ? "Cancel" : "Run ability"}</button> : null}</div>
      {open ? <form onSubmit={submit} className="mt-4 grid gap-4 rounded-md border border-border p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">Ability<select name="abilityId" className="rounded-md border border-border bg-background px-3 py-2 font-normal">{abilities.map((ability) => <option key={ability.id} value={ability.id}>{ability.id.replaceAll("-", " ")} · v{ability.version}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm font-medium">Claim mode<select name="claimMode" className="rounded-md border border-border bg-background px-3 py-2 font-normal"><option value="descriptive">Descriptive</option><option value="attitude">Attitude</option><option value="behavior">Behavior</option><option value="demand_proxy">Demand proxy</option><option value="causal">Causal</option></select></label>
        <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Research question<input required name="question" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
        <label className="flex flex-col gap-1 text-sm font-medium">Market<input name="market" placeholder="DK" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label><label className="flex flex-col gap-1 text-sm font-medium">Language<input name="language" placeholder="da" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
        <fieldset className="rounded-md border border-border p-3 md:col-span-2"><legend className="px-1 text-sm font-medium">Evidence</legend><div className="mt-2 grid gap-2 md:grid-cols-2">{evidence.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={() => setSelectedEvidence((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span>{item.synthesis ?? item.externalReference}<span className="block text-xs text-muted">{item.sourceClass} · {item.grade}</span></span></label>)}</div></fieldset>
        <p className="text-xs text-muted md:col-span-2">Leave the analysis fields empty to receive an evidence-gap assessment. Supplied analysis is policy-checked; it is never silently treated as truth.</p>
        {(["pointOfView", "clientRelevance", "recommendation", "nextDecision"] as const).map((name) => <label key={name} className="flex flex-col gap-1 text-sm font-medium">{name.replace(/([A-Z])/g, " $1")}<textarea name={name} rows={2} className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>)}
        <label className="flex flex-col gap-1 text-sm font-medium">Contradictions<input name="contradictions" placeholder="Comma-separated" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label><label className="flex flex-col gap-1 text-sm font-medium">Uncertainty<input name="uncertainty" placeholder="Comma-separated" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
        {error ? <p className="text-sm text-[var(--status-danger-text)] md:col-span-2">{error}</p> : null}<button className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-2">Create governed brief</button>
      </form> : null}
      <div className="mt-4 grid gap-3">
        {briefs.map(({ id, brief }) => {
          const ability = abilities.find((item) => item.id === brief.abilityId && item.version === brief.abilityVersion);
          return <article key={id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium text-muted uppercase">{brief.abilityId} · v{brief.abilityVersion}</p><h3 className="font-medium">{brief.question}</h3></div><span className={`rounded-full px-2 py-1 text-xs ${brief.status === "ready" ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)]" : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]"}`}>{brief.status}</span></div>
            <p className="mt-3 text-sm font-medium">{brief.pointOfView}</p>
            <p className="mt-2 text-sm text-muted">{brief.recommendation}</p>
            <p className="mt-3 text-xs text-muted">Evidence: {brief.evidenceIds.length} · Citations: {brief.citations.length} · Gaps: {brief.researchGaps.length}</p>
            {brief.researchGaps.length ? <ul className="mt-2 list-disc pl-5 text-xs text-[var(--status-warning-text)]">{brief.researchGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}
            <details className="mt-3 rounded-md border border-border p-3 text-xs">
              <summary className="cursor-pointer font-medium">Evidence, uncertainty and method</summary>
              <p className="mt-3 text-muted"><span className="font-medium text-foreground">Method:</span> {ability?.method ?? "The original versioned ability manifest is unavailable."}</p>
              <p className="mt-2 text-muted"><span className="font-medium text-foreground">Client relevance:</span> {brief.clientRelevance}</p>
              <p className="mt-2 text-muted"><span className="font-medium text-foreground">Next decision:</span> {brief.nextDecision}</p>
              {brief.citations.length ? <ul className="mt-3 grid gap-2">{brief.citations.map((citation) => <li key={citation.id} className="rounded border border-border p-2"><span className="font-medium">{citation.level}</span> · {citation.safeReference}{citation.expiresAt ? ` · expires ${new Date(citation.expiresAt).toLocaleDateString()}` : ""}{citation.reviewReason ? <span className="block text-muted">{citation.reviewReason}</span> : null}</li>)}</ul> : <p className="mt-3 text-muted">No citation passed evidence selection.</p>}
              {brief.contradictions.length ? <p className="mt-3 text-muted"><span className="font-medium text-foreground">Contradictions:</span> {brief.contradictions.join(" · ")}</p> : null}
              {brief.uncertainty.length ? <p className="mt-2 text-muted"><span className="font-medium text-foreground">Uncertainty:</span> {brief.uncertainty.join(" · ")}</p> : null}
            </details>
          </article>;
        })}
        {briefs.length === 0 ? <p className="py-4 text-center text-sm text-muted">No decision briefs yet.</p> : null}
      </div>
    </section>
  );
}

