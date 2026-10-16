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

function commaList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

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
  const [revoking, setRevoking] = useState<number | null>(null);
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
          rightsExpiresAt: data.get("rightsExpiresAt"),
          restrictions: commaList(data.get("restrictions")),
          retentionDays: data.get("retentionDays"),
          rawRetentionHours: data.get("rawRetentionHours"),
          permissions: commaList(data.get("permissions")),
          dataClassifications: data.getAll("dataClassifications"),
          permittedPurposes: commaList(data.get("permittedPurposes")),
          markets: commaList(data.get("markets")),
          languages: commaList(data.get("languages")),
          cadence: data.get("cadence"),
          lookbackDays: data.get("lookbackDays"),
          quota: data.get("quota"),
          costLimit: data.get("costLimit"),
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

  async function revoke(id: number) {
    const reason = window.prompt("Why is this source being revoked? Its active jobs will be cancelled and retained content will be expired.");
    if (!reason) return;
    setRevoking(id);
    setError(null);
    try {
      const response = await fetch("/api/workspace/sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Source could not be revoked."); return; }
      const refresh = await fetch("/api/workspace/sources");
      const refreshed = await refresh.json();
      setSources(refreshed.sources ?? []);
    } finally { setRevoking(null); }
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
          <label className="flex flex-col gap-1 text-sm font-medium">
            Markets
            <input required name="markets" placeholder="DK, SE" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Languages
            <input required name="languages" placeholder="da, en" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Permissions/scopes
            <input required name="permissions" placeholder="read:reports, aggregate:metrics" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Permitted purposes
            <input required name="permittedPurposes" placeholder="market-research, campaign-analysis" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <fieldset className="rounded-md border border-border p-3 md:col-span-2">
            <legend className="px-1 text-sm font-medium">Data classifications</legend>
            <div className="flex flex-wrap gap-4 text-sm">{["public", "licensed", "client-confidential"].map((value) => <label key={value} className="flex items-center gap-2"><input name="dataClassifications" value={value} type="checkbox" />{value}</label>)}</div>
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Acquisition cadence
            <select name="cadence" defaultValue="weekly" className="rounded-md border border-border bg-background px-3 py-2 font-normal">{["manual", "hourly", "daily", "weekly", "monthly", "quarterly"].map((value) => <option key={value}>{value}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Lookback days
            <input required name="lookbackDays" type="number" min="1" max="3650" defaultValue="30" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Provider quota (optional)
            <input name="quota" type="number" min="0" step="any" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Cost limit (optional)
            <input name="costLimit" type="number" min="0" step="any" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Rights expiry (optional)
            <input name="rightsExpiresAt" type="date" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Rights restrictions (optional)
            <input name="restrictions" placeholder="No redistribution, internal use only" className="rounded-md border border-border bg-background px-3 py-2 font-normal" />
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
          <thead><tr className="border-b border-border text-xs text-muted uppercase"><th className="py-2 pr-4">Connector</th><th className="py-2 pr-4">Scope</th><th className="py-2 pr-4">Health</th><th className="py-2 pr-4">Rights</th><th className="py-2 pr-4">Retention / limits</th><th className="py-2"></th></tr></thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id} className="border-b border-border last:border-0">
                <td className="py-3 pr-4"><span className="font-medium">{source.connectorId}</span><span className="ml-2 font-mono text-xs text-muted">v{source.connectorVersion}</span>{source.hasCredentialReference ? <span className="block text-xs text-muted">credential reference configured</span> : null}</td>
                <td className="py-3 pr-4">{source.sourceClass}<span className="block text-xs text-muted">{source.policy.markets.join(", ") || "legacy: markets not declared"} · {source.policy.languages.join(", ") || "languages not declared"}</span><span className="block text-xs text-muted">{source.policy.cadence} · {source.policy.lookbackDays}d lookback</span></td>
                <td className="py-3 pr-4"><span className="rounded-full bg-[var(--status-warning-bg)] px-2 py-1 text-xs text-[var(--status-warning-text)]">{source.health}</span></td>
                <td className="py-3 pr-4">{source.rights.basis}{source.rights.commercialUse ? " · commercial" : " · restricted"}</td>
                <td className="py-3">{source.retentionDays}d evidence · {source.rawRetentionHours}h raw<span className="block text-xs text-muted">quota {source.policy.quota ?? "unbounded"} · cost {source.policy.costLimit ?? "unbounded"}</span></td>
                <td className="py-3 text-right">{isAdmin && source.health !== "unavailable" ? <button type="button" disabled={revoking === source.id} onClick={() => void revoke(source.id)} className="rounded-md border border-[var(--status-danger-text)] px-2 py-1 text-xs text-[var(--status-danger-text)] disabled:opacity-60">{revoking === source.id ? "Revoking…" : "Revoke"}</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sources.length === 0 ? <p className="py-6 text-center text-sm text-muted">No source connections configured.</p> : null}
      </div>
    </section>
  );
}

