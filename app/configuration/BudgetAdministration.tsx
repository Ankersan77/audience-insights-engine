"use client";

import { useState } from "react";
import { amountToMicros, budgetCount, formatMicros, parseBudgetEdit, type BudgetEdit, type BudgetSummary, type BudgetWorkspace } from "@/src/core/budgetAdministration";

const inputStyle = "rounded-md border border-border bg-background px-3 py-2 font-normal";
const buttonStyle = "rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50";
const messages: Record<string, string> = {
  "budget-version-conflict": "This budget changed after you opened it. Refresh and review the current limits before saving again.",
  "budget-currency-locked": "Currency cannot change after the first reservation. Restore the current currency; a currency migration requires an operator.",
  "budget-permission-denied": "Your administrator permission or session is no longer valid. Sign in again or contact the client owner.",
  "authentication-required": "Your session has ended. Sign in again before editing a budget.",
  "budget-invalid-edit": "Check all fields and explicitly confirm the change. Limits must be non-negative whole counts and an exact currency amount.",
};

function BudgetCard({ summary, busy, save }: { summary: BudgetSummary; busy: boolean; save: (edit: BudgetEdit) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const { policy, usage, kind, backlog } = summary;
  const title = kind === "acquisition" ? "Source acquisition" : "Research synthesis";
  const overCap = policy && (BigInt(usage.authorizedCostMicros) > BigInt(policy.dailyCostMicros)
    || BigInt(usage.authorizedRequests) > BigInt(policy.dailyRequests)
    || (kind === "acquisition" && BigInt(usage.authorizedRecords ?? "0") > BigInt(policy.dailyRecords ?? 0)));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const data = new FormData(event.currentTarget);
    let edit: BudgetEdit;
    try {
      edit = parseBudgetEdit({ kind, expectedVersion: policy?.version ?? null, confirmed, policy: {
        currency: String(data.get("currency")).trim().toUpperCase(), dailyCostMicros: amountToMicros(String(data.get("amount"))),
        dailyRequests: budgetCount(String(data.get("requests"))), enabled: data.get("enabled") === "on",
        ...(kind === "acquisition" ? { dailyRecords: budgetCount(String(data.get("records"))) } : {}),
      } });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the budget fields."); return; }
    try { await save(edit); setEditing(false); setConfirmed(false); }
    catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setError(messages[code] ?? "The save could not be confirmed. Do not retry blindly: refresh to inspect the saved version first.");
      setRequiresRefresh(code !== "budget-invalid-edit" && code !== "budget-currency-locked");
      setConfirmed(false);
    }
  }

  return <article className="min-w-0 rounded-lg border border-border bg-surface p-5" aria-labelledby={`budget-${kind}`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 id={`budget-${kind}`} className="font-semibold">{title}</h3><span className="text-sm text-muted">{!policy ? "Not configured" : policy.enabled ? "Allowance enabled" : "Allowance disabled"}</span></div>
    <p className="mt-2 text-sm text-muted">{kind === "acquisition" ? "Shared across this client's sources. Editing limits does not cancel work already authorized; cancel its job or revoke its source separately." : "Separate from source budgets. Every saved change invalidates earlier synthesis grants, including authorization to release in-flight answers."}</p>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
      <dt>Daily cost cap</dt><dd>{policy ? `${formatMicros(policy.dailyCostMicros)} ${policy.currency}` : "No allowance"}</dd>
      <dt>Reserved today</dt><dd>{formatMicros(usage.authorizedCostMicros)} {policy?.currency ?? "currency units"}</dd>
      <dt>Requests reserved / cap</dt><dd>{usage.authorizedRequests} / {policy?.dailyRequests ?? "—"}</dd>
      {kind === "acquisition" ? <><dt>Records reserved / cap</dt><dd>{usage.authorizedRecords} / {policy?.dailyRecords ?? "—"}</dd></> : null}
      <dt>Configuration version</dt><dd>{policy?.version ?? "None"}</dd>
    </dl>
    {overCap ? <p className="mt-3 text-sm text-[var(--status-warning-text)]">Existing reservations exceed the current cap. They remain charged against the allowance; new admissions must fit every limit.</p> : null}
    {backlog ? <div className="mt-4 rounded-md border border-border p-3 text-sm"><p>All-day recovery backlog: {backlog.expiredUnresolvedAttempts} expired unresolved · {backlog.unknownAttempts} unknown outcomes.</p>{backlog.oldestExpiredAt ? <p className="mt-1 break-words text-muted">Oldest expired deadline: {backlog.oldestExpiredAt}</p> : null}<p className="mt-1 text-muted">Unknown does not mean free or safe to retry. Recovery never refunds reservations.</p></div> : null}
    <button type="button" disabled={busy} className={`${buttonStyle} mt-4`} aria-expanded={editing} onClick={() => { setEditing(!editing); setConfirmed(false); if (!requiresRefresh) setError(null); }}>{editing ? "Cancel edit" : `Edit ${kind} budget`}</button>
    {editing ? <form onSubmit={submit} className="mt-4">
      <fieldset disabled={busy || requiresRefresh} className="grid gap-3" onChange={(event) => { if (event.target instanceof HTMLInputElement && event.target.name !== "confirmed") setConfirmed(false); }}>
        <legend className="mb-3 text-sm font-medium">Explicit daily limits · UTC authorization day</legend>
        <label className="flex flex-col gap-1 text-sm">Currency code<input required name="currency" maxLength={3} pattern="[A-Za-z]{3}" placeholder="e.g. DKK" defaultValue={policy?.currency ?? ""} className={inputStyle} /></label>
        <label className="flex flex-col gap-1 text-sm">Daily amount in currency units<input required name="amount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" placeholder="No default allowance" defaultValue={policy ? formatMicros(policy.dailyCostMicros) : ""} className={inputStyle} /></label>
        <p className="text-xs text-muted">Use a dot for decimals, up to six places. Currency is fixed after the first reservation.</p>
        <label className="flex flex-col gap-1 text-sm">Daily request cap<input required name="requests" inputMode="numeric" pattern="[0-9]+" defaultValue={policy?.dailyRequests ?? ""} className={inputStyle} /></label>
        {kind === "acquisition" ? <label className="flex flex-col gap-1 text-sm">Daily record cap<input required name="records" inputMode="numeric" pattern="[0-9]+" defaultValue={policy?.dailyRecords ?? ""} className={inputStyle} /></label> : null}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? false} className="mt-1" />Enable this allowance for otherwise approved work.</label>
        <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="confirmed" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />I approve these limits and understand that this does not refund usage, approve a provider or verify source permissions.</label>
        <button disabled={busy || !confirmed} className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] disabled:opacity-50">{busy ? "Saving…" : "Save budget limits"}</button>
      </fieldset>
    </form> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--status-danger-text)]">{error}</p> : null}
  </article>;
}

/** Mounted only by the server's admin/owner branch. API permission checks remain authoritative. */
export function BudgetAdministration({ initial }: { initial: BudgetWorkspace }) {
  const [workspace, setWorkspace] = useState(initial);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/configuration/budgets", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setWorkspace(await response.json()); setGeneration((value) => value + 1); setMessage("Budget snapshot refreshed; unsaved edits discarded.");
    } catch { setMessage("Budgets could not be refreshed. Check your session and try again; no edit was sent."); }
    finally { setBusy(false); }
  }
  async function save(edit: BudgetEdit) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/configuration/budgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "budget-save-unconfirmed");
      setWorkspace(payload); setMessage("Budget limits saved. No usage was reset and no provider was activated.");
    } finally { setBusy(false); }
  }
  return <section className="my-6" aria-labelledby="budget-administration-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="budget-administration-heading" className="text-lg font-semibold">Budgets & recovery</h2><p className="mt-1 max-w-3xl text-sm text-muted">Reserved upper bounds, not measured provider charges. All statuses count on their UTC authorization day. Budgets are private to this client and are not included in portable packages.</p></div><button type="button" disabled={busy} onClick={refresh} className={buttonStyle}>Refresh (discard edits)</button></div>
    <p className="mt-2 text-xs text-muted">Snapshot: {workspace.observedAt}. Usage may change while work runs; admission checks the live ledger.</p>
    {message ? <p role="status" className="mt-3 text-sm">{message}</p> : null}
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">{workspace.budgets.map((summary) => <BudgetCard key={`${summary.kind}:${summary.policy?.version ?? "none"}:${generation}`} summary={summary} busy={busy} save={save} />)}</div>
  </section>;
}
