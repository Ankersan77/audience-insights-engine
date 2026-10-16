"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/src/components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/src/components/DataTable";
import { StatusBadge, type Status } from "@/src/components/StatusBadge";
import type { InsightListRow, QueueFilter } from "@/src/db/queries/insights";
import type { InsightEvidenceDetail } from "@/src/db/queries/insights";

// Necessary plumbing for T23 (same precedent as RunsTable.tsx/ChannelsManager.tsx):
// the server page can't pass DataTable's render-function columns or React
// state across the server/client boundary, so the interactive half of the
// screen lives in its own "use client" file.

type BrandOption = { id: number; name: string };

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "discarded", label: "Discarded" },
];

type Props = {
  initialInsights: InsightListRow[];
  brands: BrandOption[];
  isAdmin: boolean;
  currentFilter: QueueFilter;
  currentBrandId: number | null;
};

type ConfirmMode = "accept" | "discard" | null;

export function InsightsQueue({ initialInsights, brands, isAdmin, currentFilter, currentBrandId }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<InsightListRow | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [evidence, setEvidence] = useState<InsightEvidenceDetail[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function navigate(next: { status?: QueueFilter; brandId?: number | null }) {
    const status = next.status ?? currentFilter;
    const brandId = next.brandId === undefined ? currentBrandId : next.brandId;
    const qs = new URLSearchParams({ status });
    if (brandId) qs.set("brandId", String(brandId));
    router.push(`/insights?${qs.toString()}`);
  }

  async function openInsight(row: InsightListRow) {
    setSelected(row);
    setDraftTitle(row.title);
    setDraftSummary(row.summary);
    setAcknowledged(false);
    setActionError(null);
    setEvidence([]);
    const response = await fetch(`/api/insights/${row.id}/decision`);
    if (response.ok) {
      const data = (await response.json()) as { evidence: InsightEvidenceDetail[] };
      setEvidence(data.evidence);
    }
  }

  function closeDetail() {
    setSelected(null);
    setConfirmMode(null);
  }

  const hasSensitiveEvidence = evidence.some((e) => e.sensitivityFlag === true);

  async function submitDecision(action: "accept" | "discard") {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/insights/${selected.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          title: action === "accept" ? draftTitle : undefined,
          summary: action === "accept" ? draftSummary : undefined,
          acknowledgedSensitive: acknowledged,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setActionError(data.error ?? "That action could not be completed.");
        return;
      }
      router.refresh();
      closeDetail();
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<InsightListRow>[] = [
    { key: "id", header: "#", sortAccessor: (r) => r.id, render: (r) => `#${r.id}` },
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "brand", header: "Brand", sortAccessor: (r) => r.brandName, render: (r) => r.brandName },
    { key: "market", header: "Market", render: (r) => r.marketCode ?? "—" },
    { key: "type", header: "Type", render: (r) => r.insightType },
    { key: "classification", header: "Classification", render: (r) => r.shiftOrBlip },
    {
      key: "confidence",
      header: "Confidence",
      align: "right",
      sortAccessor: (r) => r.confidence,
      render: (r) => r.confidence.toFixed(2),
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status as Status} /> },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <button
          type="button"
          onClick={() => openInsight(r)}
          className="rounded-md border border-[var(--button-secondary-border)] px-2 py-1 text-xs font-medium text-[var(--button-secondary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {isAdmin ? "Review" : "View"}
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Queue filter">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={currentFilter === f.value}
              onClick={() => navigate({ status: f.value })}
              className={`rounded-full px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                currentFilter === f.value
                  ? "bg-[var(--button-primary-bg)] text-[var(--button-primary-text)]"
                  : "border border-border text-foreground hover:bg-surface"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="insight-brand-filter" className="sr-only">
            Brand
          </label>
          <select
            id="insight-brand-filter"
            value={currentBrandId ?? ""}
            onChange={(e) => navigate({ brandId: e.target.value ? Number(e.target.value) : null })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataTable
        caption="Insights"
        columns={columns}
        rows={initialInsights}
        getRowId={(row) => String(row.id)}
        status="success"
        emptyMessage="Nothing in this view yet."
        onRowActivate={openInsight}
      />

      {selected ? (
        <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-foreground">
              Insight #{selected.id} · {selected.shiftOrBlip}
            </h2>
            <button
              type="button"
              onClick={closeDetail}
              className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Close
            </button>
          </div>

          {isAdmin && selected.status === "pending" ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">Title</span>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">Summary</span>
                <textarea
                  value={draftSummary}
                  onChange={(e) => setDraftSummary(e.target.value)}
                  rows={4}
                  className="rounded-md border border-border bg-background px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground">{selected.title}</p>
              <p className="text-sm text-muted">{selected.summary}</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">Evidence ({evidence.length})</h3>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted">No linked evidence.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {evidence.map((item) => (
                  <li key={item.id} className="rounded-md border border-border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{item.source}</span>
                      {item.sensitivityFlag ? (
                        <span className="rounded-full bg-[var(--status-danger-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-danger-text)]">
                          Sensitive content
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-foreground">{item.textSnippet ?? "(no text)"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hasSensitiveEvidence && isAdmin && selected.status === "pending" ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-[var(--status-danger-text)] bg-[var(--status-danger-bg)] p-3 text-sm text-[var(--status-danger-text)]"
            >
              <p>This insight includes sensitivity-flagged evidence. Acknowledge before accepting.</p>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                I have reviewed the sensitive content and want to proceed.
              </label>
            </div>
          ) : null}

          {actionError ? <p className="text-sm text-[var(--status-danger-text)]">{actionError}</p> : null}

          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              {selected.status === "pending" ? (
                <>
                  <button
                    type="button"
                    disabled={hasSensitiveEvidence && !acknowledged}
                    onClick={() => setConfirmMode("accept")}
                    className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    Accept insight
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmMode("discard")}
                    className="rounded-md border border-[var(--button-secondary-border)] px-3 py-2 text-sm font-medium text-[var(--button-secondary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    Discard
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmMode !== null}
        title={
          confirmMode === "discard"
            ? "Discard this insight?"
            : "Accept this insight?"
        }
        body={
          confirmMode === "discard" ? (
            <p>This insight will be marked discarded.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-foreground">{draftTitle}</p>
              <p>{draftSummary}</p>
              <p className="text-xs text-muted">This records the approved version in Market Research.</p>
            </div>
          )
        }
        confirmLabel={busy ? "Working…" : confirmMode === "discard" ? "Discard" : "Accept"}
        destructive={confirmMode === "discard"}
        onConfirm={() => confirmMode && submitDecision(confirmMode)}
        onCancel={() => setConfirmMode(null)}
      />
    </div>
  );
}
