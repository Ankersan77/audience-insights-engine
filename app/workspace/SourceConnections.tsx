"use client";

import { useState } from "react";
import type { SourceConnectionListRow } from "@/src/db/queries/sources";

const SOURCE_CLASSES = [
  "client_owned",
  "first_party_aggregate",
  "commissioned_or_licensed",
  "official_or_public",
  "public_conversation",
  "primary_research",
] as const;

export function SourceConnections({
  initialSources,
  isAdmin,
}: {
  initialSources: SourceConnectionListRow[];
  isAdmin: boolean;
}) {
  const [sources, setSources] = useState(initialSources);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/workspace/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: data.get("connectorId"),
          connectorVersion: data.get("connectorVersion"),
          sourceClass: data.get("sourceClass"),
          credentialRef: data.get("credentialRef"),
          rightsBasis: data.get("rightsBasis"),
          commercialUse: data.get("commercialUse") === "on",
          quotationAllowed: data.get("quotationAllowed") === "on",
          retentionDays: data.get("retentionDays"),
          rawRetentionHours: data.get("rawRetentionHours"),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Source connection could not be saved.");
        return;
      }
      const refresh = await fetch("/api/workspace/sources");
      const refreshed = await refresh.json();
      setSources(refreshed.sources ?? []);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Source connections</h2>
          <p className="mt-1 text-sm text-muted">Configuration is distinct from verification and evidence production.</p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)]"
          >
            {open ? "Cancel" : "Add source"}
          </button>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-4 grid gap-4 rounded-md border border-border p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Connector id
            <input required name="connectorId" placeholder="official-statistics" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Connector version
            <input required name="connectorVersion" defaultValue="1.0.0" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Source class
            <select name="sourceClass" className="rounded-md border border-border bg-background px-3 py-2 font-normal">
              {SOURCE_CLASSES.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Rights basis
            <select name="rightsBasis" className="rounded-md border border-border bg-background px-3 py-2 font-normal">
              <option value="client_owned">Client owned</option>
              <option value="licensed">Licensed</option>
              <option value="public_permitted">Public and permitted</option>
              <option value="consented">Consented</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Evidence retention days
            <input required name="retentionDays" type="number" min="1" max="3650" defaultValue="180" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Raw retention hours
            <input required name="rawRetentionHours" type="number" min="0" max="168" defaultValue="24" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Credential reference (optional)
            <input name="credentialRef" placeholder="secret-store/client/source" autoComplete="off" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
            <span className="text-xs font-normal text-muted">An opaque secret-store reference only; never paste a token or password.</span>
          </label>
          <div className="flex flex-wrap gap-4 text-sm md:col-span-2">
            <label className="flex items-center gap-2"><input required name="commercialUse" type="checkbox" /> Commercial use permitted</label>
            <label className="flex items-center gap-2"><input name="quotationAllowed" type="checkbox" /> Quotation permitted</label>
          </div>
          {error ? <p className="text-sm text-[var(--status-danger-text)] md:col-span-2">{error}</p> : null}
          <div className="md:col-span-2">
            <button disabled={submitting} className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] disabled:opacity-60">
              {submitting ? "Saving…" : "Save configured source"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead><tr className="border-b border-border text-xs text-muted uppercase"><th className="py-2 pr-4">Connector</th><th className="py-2 pr-4">Class</th><th className="py-2 pr-4">Health</th><th className="py-2 pr-4">Rights</th><th className="py-2">Retention</th></tr></thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id} className="border-b border-border last:border-0">
                <td className="py-3 pr-4"><span className="font-medium">{source.connectorId}</span><span className="ml-2 font-mono text-xs text-muted">v{source.connectorVersion}</span>{source.hasCredentialReference ? <span className="block text-xs text-muted">credential reference configured</span> : null}</td>
                <td className="py-3 pr-4">{source.sourceClass}</td>
                <td className="py-3 pr-4"><span className="rounded-full bg-[var(--status-warning-bg)] px-2 py-1 text-xs text-[var(--status-warning-text)]">{source.health}</span></td>
                <td className="py-3 pr-4">{source.rights.basis}{source.rights.commercialUse ? " · commercial" : " · restricted"}</td>
                <td className="py-3">{source.retentionDays}d evidence · {source.rawRetentionHours}h raw</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sources.length === 0 ? <p className="py-6 text-center text-sm text-muted">No source connections configured.</p> : null}
      </div>
    </section>
  );
}

