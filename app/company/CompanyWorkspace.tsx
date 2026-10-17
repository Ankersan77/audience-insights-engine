"use client";

import { useState } from "react";
import { COMPANY_TEXT_FIELDS, parseCompanyContextContent, type CompanyContext, type CompanyContextContent } from "@/src/core/companyContext";

const labels = { name: "Company name", offer: "Offer and operating model", audiences: "Target audience and decision-makers", valueProposition: "Value proposition", positioning: "Intended positioning", priorities: "Business and research priorities", constraints: "Constraints and known gaps" };
const empty: CompanyContextContent = { name: "", offer: "", audiences: "", valueProposition: "", positioning: "", priorities: "", constraints: "", markets: [], languages: [], sourceBindings: [] };
type Source = { id: number; name: string; sourceClass: string; health: string };
export function CompanyWorkspace({ initial, gaps, history, canEdit, sources }: { initial: CompanyContext | null; gaps: string[]; history: CompanyContext[]; canEdit: boolean; sources: Source[] }) {
  const [draft, setDraft] = useState(initial?.content ?? empty);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const control = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/company-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: initial?.version ?? null, content: draft, reviewAfter: new Date(`${data.get("reviewAfter")}T00:00:00.000Z`).toISOString(), changeReason: data.get("changeReason") }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error === "company-context-version-conflict" ? "The company profile changed in another session. Reload and reconcile your changes before saving." : result.error ?? "Save unconfirmed. Reload before retrying."); return; }
      window.location.reload();
    } catch { setError("Save unconfirmed. Reload before retrying."); } finally { setSaving(false); }
  }
  return <div className="grid min-w-0 gap-5">
    <section className="rounded-lg border border-border bg-surface p-5"><h2 className="font-medium">{initial ? `Current company profile · version ${initial.version}` : "No company profile yet"}</h2>
      <p className="mt-2 text-sm text-muted">Owner-declared context is reused automatically; it is not independently verified demand, differentiation or market evidence. A future agent must read the current version for each task.</p>
      {initial ? <p className="mt-2 text-xs text-muted">Declared {initial.recordedAt.slice(0, 10)} by user #{initial.declaredBy}. Review due {initial.reviewAfter.slice(0, 10)}. Old research retains its original version.</p> : null}
      {gaps.map((gap) => <p key={gap} className="mt-2 text-sm text-[var(--status-warning-text)]">{gap}</p>)}
      {initial ? <dl className="mt-4 grid gap-3 md:grid-cols-2">{COMPANY_TEXT_FIELDS.map((key) => <div key={key} className="min-w-0"><dt className="text-sm font-medium">{labels[key]}</dt><dd className="whitespace-pre-wrap break-words text-sm text-muted">{initial.content[key] || "Not declared"}</dd></div>)}<div><dt>Scope</dt><dd className="text-sm text-muted">{initial.content.markets.join(", ")} · {initial.content.languages.join(", ")}</dd></div></dl> : null}
    </section>
    <section className="rounded-lg border border-border p-5"><h2 className="font-medium">Company data sources</h2><p className="mt-2 text-sm text-muted">References only. CRM/sales values remain dated aggregate evidence, not numbers copied into the profile. No consumer/contact records or credentials belong here. Binding a source does not activate sync or establish permission, freshness or research coverage.</p>
      {initial?.content.sourceBindings.length ? initial.content.sourceBindings.map((binding) => { const source = sources.find((item) => item.id === binding.sourceConnectionId); return <p key={`${binding.purpose}:${binding.sourceConnectionId}`} className="mt-2 break-words text-sm">{binding.purpose}: {source?.name ?? "Source unavailable"} · {source?.health ?? "needs_context"}</p>; }) : <p className="mt-2 text-sm text-muted">No sources bound. No CRM or sales figures are assumed.</p>}
      <a href="/configuration" className="mt-3 inline-block text-sm underline">Manage approved sources</a>
    </section>
    {canEdit ? <form onSubmit={submit} className="grid min-w-0 gap-4 rounded-lg border border-border p-5 md:grid-cols-2"><h2 className="font-medium md:col-span-2">{initial ? "Publish a new company profile version" : "Declare company profile"}</h2>
      <p className="text-sm text-muted md:col-span-2">Owner/admin confirmation is required. Research and connector outputs cannot overwrite this profile. Dates are UTC. Import fills the form only; inspect it before saving.</p>
      <label className="text-sm md:col-span-2">Import profile content JSON<input type="file" accept="application/json,.json" className={control} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 65536) throw new Error(); setDraft(parseCompanyContextContent(JSON.parse(await file.text()))); setError(null); } catch { setError("Invalid profile file. Import only bounded company context, never credentials or person-level data."); } }} /></label>
      {COMPANY_TEXT_FIELDS.map((key) => <div key={key} className="min-w-0 text-sm font-medium"><label htmlFor={`company-${key}`}>{labels[key]}</label><textarea id={`company-${key}`} name={key} required={["name", "offer", "audiences", "valueProposition"].includes(key)} maxLength={4000} rows={key === "name" ? 1 : 3} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} className={control} /></div>)}
      {(["markets", "languages"] as const).map((key) => <label key={key} className="text-sm font-medium">{key === "markets" ? "Markets (comma-separated)" : "Languages (comma-separated)"}<input required value={draft[key].join(",")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value.split(",") })} onBlur={() => setDraft({ ...draft, [key]: draft[key].map((item) => item.trim()).filter(Boolean) })} className={control} /></label>)}
      <label className="text-sm font-medium">Review due<input required name="reviewAfter" type="date" defaultValue={initial?.reviewAfter.slice(0, 10)} className={control} /></label><label className="text-sm font-medium">Reason for this version<input required name="changeReason" maxLength={4000} className={control} /></label>
      <fieldset className="grid gap-3 md:col-span-2"><legend className="mb-2 text-sm font-medium">Source bindings (optional)</legend>{(["strategy", "crm_aggregate", "sales_aggregate"] as const).map((purpose) => <label key={purpose} className="text-sm">{purpose}<select multiple className={control} value={draft.sourceBindings.filter((item) => item.purpose === purpose).map((item) => String(item.sourceConnectionId))} onChange={(event) => setDraft({ ...draft, sourceBindings: [...draft.sourceBindings.filter((item) => item.purpose !== purpose), ...Array.from(event.target.selectedOptions).map((option) => ({ purpose, sourceConnectionId: Number(option.value) }))] })}>{sources.filter((item) => item.sourceClass === (purpose === "strategy" ? "client_owned" : "first_party_aggregate")).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.health}</option>)}</select></label>)}</fieldset>
      {error ? <p role="alert" className="text-sm text-[var(--status-danger-text)] md:col-span-2">{error}</p> : null}<button disabled={saving} className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] md:col-span-2">{saving ? "Saving…" : "Save company profile version"}</button>
    </form> : null}
    <section className="rounded-lg border border-border p-5"><h2 className="font-medium">Version history (latest 50)</h2>{history.map((item) => <details key={item.version} className="mt-3"><summary>Version {item.version} · {item.recordedAt.slice(0, 10)} · {item.version === initial?.version ? "current" : "historical, not current context"}</summary><p className="mt-2 break-words text-sm">{item.changeReason}</p><dl className="mt-2 grid gap-2">{COMPANY_TEXT_FIELDS.map((key) => <div key={key}><dt className="text-xs font-medium">{labels[key]}</dt><dd className="whitespace-pre-wrap break-words text-sm">{item.content[key] || "Not declared"}</dd></div>)}</dl></details>)}</section>
  </div>;
}
