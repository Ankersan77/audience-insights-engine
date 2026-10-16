"use client";

import { useState } from "react";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { IntelligenceListRow } from "@/src/db/queries/workspace_intelligence";

function commaList(value: FormDataEntryValue | null): string[] {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

export function MarketTwin({ initialRecords, evidence, canResearch, canReview }: { initialRecords: IntelligenceListRow[]; evidence: CanonicalEvidenceListRow[]; canResearch: boolean; canReview: boolean }) {
  const [records, setRecords] = useState(initialRecords);
  const [open, setOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<number[]>([]);
  const [selectedContradictions, setSelectedContradictions] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/workspace/intelligence");
    const payload = await response.json();
    setRecords(payload.records ?? []);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/workspace/intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: data.get("kind"), title: data.get("title"), statement: data.get("statement"),
        confidence: Number(data.get("confidence")), evidenceIds: selectedEvidence,
        contradictionIds: selectedContradictions, dependencyIds: [], uncertainty: commaList(data.get("uncertainty")),
        markets: commaList(data.get("markets")), languages: commaList(data.get("languages")),
        categories: commaList(data.get("categories")), audiences: commaList(data.get("audiences")), campaigns: commaList(data.get("campaigns")),
      }),
    });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Candidate could not be created."); return; }
    setSelectedEvidence([]);
    setSelectedContradictions([]);
    setOpen(false);
    await refresh();
  }

  async function review(id: string, decision: "accepted" | "rejected" | "revision_requested") {
    const response = await fetch(`/api/workspace/intelligence/${id}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
    });
    if (response.ok) await refresh();
  }

  async function promote(id: string) {
    const response = await fetch(`/api/workspace/intelligence/${id}/promote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? "Learning could not be promoted."); return; }
    await refresh();
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-foreground">Market Twin</h2><p className="mt-1 text-sm text-muted">Observations, facts, hypotheses and gaps remain reviewable, traceable and distinct.</p></div>
        {canResearch ? <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]">{open ? "Cancel" : "Add candidate"}</button> : null}
      </div>
      {open ? (
        <form onSubmit={submit} className="mt-4 grid gap-4 rounded-md border border-border p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">Kind<select name="kind" className="rounded-md border border-border bg-background px-3 py-2 font-normal"><option value="observation">Observation</option><option value="fact">Sourced fact</option><option value="hypothesis">Hypothesis</option><option value="knowledge_gap">Knowledge gap</option></select></label>
          <label className="flex flex-col gap-1 text-sm font-medium">Confidence<input name="confidence" type="number" min="0" max="1" step="0.05" defaultValue="0.6" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Title<input required name="title" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Statement<textarea required name="statement" rows={3} className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>
          <fieldset className="rounded-md border border-border p-3 md:col-span-2"><legend className="px-1 text-sm font-medium">Supporting evidence</legend><div className="mt-2 grid gap-2 md:grid-cols-2">{evidence.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={() => setSelectedEvidence((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span>{item.synthesis ?? item.externalReference}<span className="block text-xs text-muted">{item.connectorId} · {item.lifecycle}</span></span></label>)}</div></fieldset>
          <fieldset className="rounded-md border border-border p-3 md:col-span-2"><legend className="px-1 text-sm font-medium">Contradicts existing records</legend><div className="mt-2 grid gap-2 md:grid-cols-2">{records.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selectedContradictions.includes(Number(item.id))} onChange={() => setSelectedContradictions((current) => current.includes(Number(item.id)) ? current.filter((id) => id !== Number(item.id)) : [...current, Number(item.id)])} /><span>{item.title}<span className="block text-xs text-muted">{item.kind} · {item.reviewState}</span></span></label>)}</div></fieldset>
          {(["markets", "languages", "categories", "audiences", "campaigns", "uncertainty"] as const).map((name) => <label key={name} className="flex flex-col gap-1 text-sm font-medium capitalize">{name}<input name={name} placeholder="Comma-separated" className="rounded-md border border-border bg-background px-3 py-2 font-normal" /></label>)}
          {error ? <p className="text-sm text-[var(--status-danger-text)] md:col-span-2">{error}</p> : null}
          <button className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-2">Create review candidate</button>
        </form>
      ) : null}
      <div className="mt-4 grid gap-3">
        {records.map((record) => <article key={record.id} className="rounded-md border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium text-muted uppercase">{record.kind}</p><h3 className="font-medium">{record.title}</h3></div><span className="rounded-full bg-[var(--status-info-bg)] px-2 py-1 text-xs text-[var(--status-info-text)]">{record.lifecycle} · {record.reviewState}</span></div><p className="mt-2 text-sm">{record.statement}</p><p className="mt-2 text-xs text-muted">Evidence: {record.evidenceIds.length} · Contradictions: {record.contradictionIds.length} · Confidence: {Math.round(record.confidence * 100)}%</p>{canReview && record.reviewState === "pending" ? <div className="mt-3 flex flex-wrap gap-2">{record.kind === "decision" ? <button onClick={() => void promote(record.id)} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--button-primary-text)]">Promote to reviewed learning</button> : <button onClick={() => void review(record.id, "accepted")} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--button-primary-text)]">Accept</button>}<button onClick={() => void review(record.id, "revision_requested")} className="rounded-md border border-border px-3 py-1.5 text-xs">Request revision</button><button onClick={() => void review(record.id, "rejected")} className="rounded-md border border-border px-3 py-1.5 text-xs text-[var(--status-danger-text)]">Reject</button></div> : null}</article>)}
        {records.length === 0 ? <p className="py-4 text-center text-sm text-muted">No Market Twin candidates yet.</p> : null}
      </div>
    </section>
  );
}

