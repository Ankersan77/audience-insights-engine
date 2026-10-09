"use client";

import { useState, type FormEvent } from "react";
import { DataTable, type DataTableColumn } from "@/src/components/DataTable";
import type {
  MarketScope,
  ResearchInstructionFields,
  ResearchInstructionHistoryRow,
  ResearchInstructionRow,
} from "@/src/db/queries/research_instructions";

type CurrentUser = { name: string; email: string };

type Props = {
  brandId: number;
  markets: MarketScope[];
  latestBrand: ResearchInstructionRow | null;
  latestByMarket: Record<number, ResearchInstructionRow>;
  brandHistory: ResearchInstructionHistoryRow[];
  marketHistories: Record<number, ResearchInstructionHistoryRow[]>;
  isAdmin: boolean;
  currentUser: CurrentUser;
};

type FormState = {
  subreddits: string;
  dedicatedSubreddits: string;
  xHandle: string;
  xRelated: string;
  tiktokHashtags: string;
  competitors: string;
  focusText: string;
};

function toFormState(row: ResearchInstructionRow | null): FormState {
  return {
    subreddits: row?.subreddits.join(", ") ?? "",
    dedicatedSubreddits: row?.dedicatedSubreddits.join(", ") ?? "",
    xHandle: row?.xHandle ?? "",
    xRelated: row?.xRelated.join(", ") ?? "",
    tiktokHashtags: row?.tiktokHashtags.join(", ") ?? "",
    competitors: row?.competitors.join(", ") ?? "",
    focusText: row?.focusText ?? "",
  };
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function toFields(form: FormState): ResearchInstructionFields {
  return {
    subreddits: parseList(form.subreddits),
    dedicatedSubreddits: parseList(form.dedicatedSubreddits),
    xHandle: form.xHandle.trim() || null,
    xRelated: parseList(form.xRelated),
    tiktokHashtags: parseList(form.tiktokHashtags),
    competitors: parseList(form.competitors),
    focusText: form.focusText.trim() || null,
  };
}

const HISTORY_COLUMNS: DataTableColumn<ResearchInstructionHistoryRow>[] = [
  {
    key: "version",
    header: "Version",
    align: "right",
    sortAccessor: (row) => row.version,
    render: (row) => row.version,
  },
  {
    key: "updatedAt",
    header: "Created",
    sortAccessor: (row) => new Date(row.updatedAt).getTime(),
    render: (row) => new Date(row.updatedAt).toLocaleString(),
  },
  {
    key: "author",
    header: "Author",
    render: (row) => `${row.updatedByName} (${row.updatedByEmail})`,
  },
];

const inputClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] read-only:bg-surface read-only:text-muted";

function Field({
  id,
  label,
  value,
  onChange,
  readOnly,
  multiline,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      {multiline ? (
        <textarea
          id={id}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}

/**
 * One brand-level-or-market scope: the form fields plus its own immutable
 * version history. Saving always creates a new version (T14) — there is no
 * update-in-place path anywhere in this component.
 */
function ScopePanel({
  brandId,
  marketId,
  initialRow,
  initialHistory,
  isAdmin,
  currentUser,
}: {
  brandId: number;
  marketId: number | null;
  initialRow: ResearchInstructionRow | null;
  initialHistory: ResearchInstructionHistoryRow[];
  isAdmin: boolean;
  currentUser: CurrentUser;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(initialRow));
  const [history, setHistory] = useState(initialHistory);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K) {
    return (value: string) => setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/brands/${brandId}/instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId, ...toFields(form) }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not save this version.");
        return;
      }
      const created: ResearchInstructionRow = data.instruction;
      setHistory((current) => [
        { ...created, updatedByName: currentUser.name, updatedByEmail: currentUser.email },
        ...current,
      ]);
    } finally {
      setSaving(false);
    }
  }

  const idPrefix = marketId === null ? "brand" : `market-${marketId}`;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          id={`${idPrefix}-subreddits`}
          label="Subreddits"
          hint="Comma-separated."
          value={form.subreddits}
          onChange={set("subreddits")}
          readOnly={!isAdmin}
        />
        <Field
          id={`${idPrefix}-dedicated-subreddits`}
          label="Dedicated subreddits"
          hint="Comma-separated."
          value={form.dedicatedSubreddits}
          onChange={set("dedicatedSubreddits")}
          readOnly={!isAdmin}
        />
        <Field
          id={`${idPrefix}-x-handle`}
          label="X handle"
          value={form.xHandle}
          onChange={set("xHandle")}
          readOnly={!isAdmin}
        />
        <Field
          id={`${idPrefix}-x-related`}
          label="X related handles"
          hint="Comma-separated."
          value={form.xRelated}
          onChange={set("xRelated")}
          readOnly={!isAdmin}
        />
        <Field
          id={`${idPrefix}-tiktok-hashtags`}
          label="TikTok hashtags"
          hint="Comma-separated."
          value={form.tiktokHashtags}
          onChange={set("tiktokHashtags")}
          readOnly={!isAdmin}
        />
        <Field
          id={`${idPrefix}-competitors`}
          label="Competitors"
          hint="Comma-separated."
          value={form.competitors}
          onChange={set("competitors")}
          readOnly={!isAdmin}
        />
        <Field
          id={`${idPrefix}-focus-text`}
          label="Focus"
          hint="Free text describing what this research run should pay attention to."
          value={form.focusText}
          onChange={set("focusText")}
          readOnly={!isAdmin}
          multiline
        />
        {error ? <p className="text-sm text-[var(--status-danger-text)]">{error}</p> : null}
        {isAdmin ? (
          <div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {saving ? "Saving…" : `Save as version ${history.length + 1}`}
            </button>
          </div>
        ) : null}
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Version history</h3>
        <DataTable
          caption={marketId === null ? "Brand default version history" : "Market override version history"}
          columns={HISTORY_COLUMNS}
          rows={history}
          getRowId={(row) => String(row.id)}
          status="success"
          emptyMessage="No versions yet."
        />
      </div>
    </div>
  );
}

type MarketScopeState = "inherit" | "override";

function MarketPanel({
  brandId,
  market,
  initialRow,
  initialHistory,
  isAdmin,
  currentUser,
}: {
  brandId: number;
  market: MarketScope;
  initialRow: ResearchInstructionRow | null;
  initialHistory: ResearchInstructionHistoryRow[];
  isAdmin: boolean;
  currentUser: CurrentUser;
}) {
  // Explicit toggle state, never an implicit empty row (T14): a market with no
  // override row starts on "inherit"; a market with history starts on
  // "override" so its existing form and history are visible immediately.
  const [scope, setScope] = useState<MarketScopeState>(initialRow ? "override" : "inherit");
  const groupName = `market-${market.id}-scope`;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {market.name} ({market.code})
        </h3>
        <fieldset className="flex items-center gap-4">
          <legend className="sr-only">Research instructions scope for {market.name}</legend>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name={groupName}
              value="inherit"
              checked={scope === "inherit"}
              onChange={() => setScope("inherit")}
              className="h-4 w-4"
            />
            Inherits brand default
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name={groupName}
              value="override"
              checked={scope === "override"}
              onChange={() => setScope("override")}
              className="h-4 w-4"
            />
            Overridden
          </label>
        </fieldset>
      </div>

      {scope === "inherit" ? (
        <p className="text-sm text-muted">
          This market uses the brand-level default instruction. Switch to &ldquo;Overridden&rdquo; to give it its own.
        </p>
      ) : (
        <ScopePanel
          brandId={brandId}
          marketId={market.id}
          initialRow={initialRow}
          initialHistory={initialHistory}
          isAdmin={isAdmin}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}

/**
 * Client half of the research-instructions editor: the brand-level default
 * form, a per-market inherit/override row for every market in `brand_market`,
 * and a read-only version history under each. The server component
 * (`page.tsx`) does the session check and the initial data fetch; this
 * component only talks to `/api/brands/[id]/instructions`, which re-checks
 * the admin role server-side on every save (T11's pattern).
 */
export function InstructionsEditor({
  brandId,
  markets,
  latestBrand,
  latestByMarket,
  brandHistory,
  marketHistories,
  isAdmin,
  currentUser,
}: Props) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold text-foreground">Brand default</h2>
        <ScopePanel
          brandId={brandId}
          marketId={null}
          initialRow={latestBrand}
          initialHistory={brandHistory}
          isAdmin={isAdmin}
          currentUser={currentUser}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Per-market overrides</h2>
        {markets.length === 0 ? (
          <p className="text-sm text-muted">This brand has no markets yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {markets.map((m) => (
              <MarketPanel
                key={m.id}
                brandId={brandId}
                market={m}
                initialRow={latestByMarket[m.id] ?? null}
                initialHistory={marketHistories[m.id] ?? []}
                isAdmin={isAdmin}
                currentUser={currentUser}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
