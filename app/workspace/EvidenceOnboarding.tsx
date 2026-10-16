"use client";

import { useState } from "react";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { SourceConnectionListRow } from "@/src/db/queries/sources";

function commaList(value: FormDataEntryValue | null): string[] {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

export function EvidenceOnboarding({
  initialEvidence,
  sources,
  canResearch,
}: {
  initialEvidence: CanonicalEvidenceListRow[];
  sources: SourceConnectionListRow[];
  canResearch: boolean;
}) {
  const [evidence, setEvidence] = useState(initialEvidence);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleSources = sources.filter((source) =>
    ["client_owned", "commissioned_or_licensed", "primary_research", "official_or_public"].includes(source.sourceClass),
  );

  async function selectFile(file: File | undefined) {
    if (!file) return;
    const allowed = ["text/plain", "text/markdown", "text/csv", "application/json"];
    if (!allowed.includes(file.type) && !/\.(txt|md|csv|json)$/i.test(file.name)) {
      setError("Use extracted text, Markdown, CSV, or JSON here. Office/PDF extraction belongs behind a verified document adapter.");
      return;
    }
    if (file.size > 500_000) {
      setError("The extracted document exceeds the 500 KB bounded-ingestion limit.");
      return;
    }
    setTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));
    setContent(await file.text());
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/workspace/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceConnectionId: Number(data.get("sourceConnectionId")),
          title,
          content,
          sourceUrl: data.get("sourceUrl"),
          method: data.get("method"),
          universe: data.get("universe"),
          sampleSize: data.get("sampleSize"),
          weighting: data.get("weighting"),
          fieldworkStart: data.get("fieldworkStart"),
          fieldworkEnd: data.get("fieldworkEnd"),
          markets: commaList(data.get("markets")),
          languages: commaList(data.get("languages")),
          categories: commaList(data.get("categories")),
          audiences: commaList(data.get("audiences")),
          campaigns: commaList(data.get("campaigns")),
          limitations: commaList(data.get("limitations")),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Evidence could not be onboarded.");
        return;
      }
      const refreshed = await fetch("/api/workspace/evidence");
      const payload = await refreshed.json();
      setEvidence(payload.evidence ?? []);
      setContent("");
      setTitle("");
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Evidence onboarding</h2>
          <p className="mt-1 text-sm text-muted">Only minimized canonical evidence is retained; raw provider payloads are not accepted.</p>
        </div>
        {canResearch && eligibleSources.length > 0 ? (
          <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]">
            {open ? "Cancel" : "Onboard evidence"}
          </button>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-4 grid gap-4 rounded-md border border-border p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">Source
            <select required name="sourceConnectionId" className="rounded-md border border-border bg-background px-3 py-2 font-normal">
              {eligibleSources.map((source) => <option key={source.id} value={source.id}>{source.connectorId} · {source.sourceClass}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Text/CSV/JSON file
            <input type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" onChange={(event) => void selectFile(event.target.files?.[0])} className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Title
            <input required value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Permitted public/source URL (optional)
            <input name="sourceUrl" type="url" placeholder="https://…" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">Extracted text
            <textarea required value={content} onChange={(event) => setContent(event.target.value)} rows={9} maxLength={500000} className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Method
            <input name="method" required placeholder="Survey, desk research, brand guide…" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Universe
            <input name="universe" placeholder="Adults 18+ in Denmark" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Sample size
            <input name="sampleSize" type="number" min="0" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Weighting
            <input name="weighting" placeholder="Age, gender, region" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Fieldwork start
            <input name="fieldworkStart" type="date" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Fieldwork end
            <input name="fieldworkEnd" type="date" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          {(["markets", "languages", "categories", "audiences", "campaigns", "limitations"] as const).map((name) => (
            <label key={name} className="flex flex-col gap-1 text-sm font-medium capitalize">{name}
              <input name={name} placeholder="Comma-separated" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
            </label>
          ))}
          {error ? <p className="text-sm text-[var(--status-danger-text)] md:col-span-2">{error}</p> : null}
          <div className="md:col-span-2">
            <button disabled={submitting} className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] disabled:opacity-60">
              {submitting ? "Applying policy…" : "Apply policy and retain evidence"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead><tr className="border-b border-border text-xs text-muted uppercase"><th className="py-2 pr-4">Evidence</th><th className="py-2 pr-4">Source</th><th className="py-2 pr-4">State</th><th className="py-2 pr-4">Quality</th><th className="py-2">Expires</th></tr></thead>
          <tbody>
            {evidence.map((item) => (
              <tr key={item.id} className="border-b border-border align-top last:border-0">
                <td className="max-w-xl py-3 pr-4"><p className="font-medium">{item.synthesis ?? item.externalReference}</p><p className="mt-1 line-clamp-2 text-muted">{item.sourceContent}</p>{item.redactions.length ? <p className="mt-1 text-xs text-[var(--status-warning-text)]">Policy: {item.redactions.join(", ")}</p> : null}</td>
                <td className="py-3 pr-4">{item.connectorId}<span className="block text-xs text-muted">{item.sourceClass}</span></td>
                <td className="py-3 pr-4"><span className={`rounded-full px-2 py-1 text-xs ${item.lifecycle === "quarantined" ? "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]" : "bg-[var(--status-info-bg)] text-[var(--status-info-text)]"}`}>{item.lifecycle}</span></td>
                <td className="py-3 pr-4">{item.grade} · {Math.round(item.confidence * 100)}%</td>
                <td className="py-3">{new Date(item.expiresAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {evidence.length === 0 ? <p className="py-6 text-center text-sm text-muted">No canonical evidence retained yet.</p> : null}
      </div>
    </section>
  );
}

