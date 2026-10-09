"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AsyncCombobox, type ComboboxOption } from "@/src/components/AsyncCombobox";
import { DataTable, type DataTableColumn } from "@/src/components/DataTable";
import type { ChannelRow, ChannelType } from "@/src/db/queries/channels";
import type { TypeScopeView } from "@/src/db/queries/insight_routes";

type BrandOption = { id: number; name: string };

type Props = {
  initialChannels: ChannelRow[];
  brands: BrandOption[];
  initialGlobalView: TypeScopeView[];
  isAdmin: boolean;
};

const DRIVE_NOTICE =
  "Delivery to Drive is recorded but not yet sent — write access is being set up.";

/** Shown next to the Slack/Drive pickers while their credential is unprovisioned (Credential-blocked epics, E5). */
async function searchSlack(query: string): Promise<ComboboxOption[]> {
  const response = await fetch(`/api/channels/slack-search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error("Slack search failed.");
  }
  const data = (await response.json()) as { channels: Array<{ id: string; name: string }> };
  return data.channels.map((c) => ({ id: c.id, label: `#${c.name}` }));
}

async function searchDrive(query: string): Promise<ComboboxOption[]> {
  const response = await fetch(`/api/channels/drive-search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error("Drive search failed.");
  }
  const data = (await response.json()) as { folders: Array<{ id: string; name: string }> };
  return data.folders.map((f) => ({ id: f.id, label: f.name }));
}

const CHANNEL_COLUMNS: DataTableColumn<ChannelRow>[] = [
  {
    key: "type",
    header: "Type",
    render: (row) => (row.type === "slack_channel" ? "Slack channel" : "Drive folder"),
  },
  {
    key: "displayName",
    header: "Name",
    sortAccessor: (row) => row.displayName,
    render: (row) => row.displayName,
  },
  { key: "externalRef", header: "Reference", render: (row) => row.externalRef },
  {
    key: "delivery",
    header: "Delivery",
    render: (row) =>
      row.type === "drive_folder" ? (
        <span className="text-sm text-[var(--status-warning-text)]">{DRIVE_NOTICE}</span>
      ) : (
        <span className="text-sm text-muted">Ready</span>
      ),
  },
  {
    key: "createdAt",
    header: "Connected",
    sortAccessor: (row) => new Date(row.createdAt).getTime(),
    render: (row) => new Date(row.createdAt).toLocaleDateString(),
  },
];

/**
 * Client half of `/channels`: the Slack/Drive connect pickers (T15/T16), the
 * table of connected channels (with the permanent Drive notice, FR9a), and
 * the Insight-Type routing map (T17). The server component (`page.tsx`) does
 * the session check and initial data fetch; every mutation here talks to an
 * admin-gated API route, which re-checks the role server-side (T11's
 * pattern) — a viewer never sees a picker, an "add channel" control, or a
 * remove button, only the read-only tables.
 */
export function ChannelsManager({ initialChannels, brands, initialGlobalView, isAdmin }: Props) {
  const [channels, setChannels] = useState(initialChannels);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connectChannel(type: ChannelType, externalRef: string, displayName: string) {
    setConnectError(null);
    const response = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, externalRef, displayName }),
    });
    const data = await response.json();
    if (!response.ok) {
      setConnectError(data.error ?? "Could not connect that channel.");
      return;
    }
    setChannels((current) => [...current, data.channel as ChannelRow]);
  }

  return (
    <div className="flex flex-col gap-10">
      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-foreground">Connect a channel</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AsyncCombobox
              label="Slack channel"
              placeholder="Search Slack channels…"
              search={searchSlack}
              onSelect={(option) =>
                connectChannel("slack_channel", option.id, option.label.replace(/^#/, ""))
              }
              emptyMessage="No matching Slack channels."
              errorMessage="Slack isn't connected yet."
            />
            <AsyncCombobox
              label="Drive folder"
              placeholder="Search Drive folders…"
              search={searchDrive}
              onSelect={(option) => connectChannel("drive_folder", option.id, option.label)}
              emptyMessage="No matching Drive folders."
              errorMessage="Drive isn't connected yet."
            />
          </div>
          {connectError ? (
            <p className="text-sm text-[var(--status-danger-text)]">{connectError}</p>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Connected channels</h2>
        <DataTable
          caption="Connected channels"
          columns={CHANNEL_COLUMNS}
          rows={channels}
          getRowId={(row) => String(row.id)}
          status="success"
          emptyMessage="No channels connected yet."
        />
      </section>

      <RoutingMap
        brands={brands}
        channels={channels}
        initialGlobalView={initialGlobalView}
        isAdmin={isAdmin}
      />
    </div>
  );
}

type ScopeOption = "global" | number;

function RoutingMap({
  brands,
  channels,
  initialGlobalView,
  isAdmin,
}: {
  brands: BrandOption[];
  channels: ChannelRow[];
  initialGlobalView: TypeScopeView[];
  isAdmin: boolean;
}) {
  const [scope, setScope] = useState<ScopeOption>("global");
  const [view, setView] = useState<TypeScopeView[]>(initialGlobalView);
  const [loadError, setLoadError] = useState(false);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [mutating, setMutating] = useState(false);

  const loadView = useCallback(async (nextScope: ScopeOption) => {
    setLoadError(false);
    try {
      const qs = nextScope === "global" ? "" : `?brandId=${nextScope}`;
      const response = await fetch(`/api/insight-routes${qs}`);
      if (!response.ok) throw new Error("load-failed");
      const data = (await response.json()) as { view: TypeScopeView[] };
      setView(data.view);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // Deferred to a timer so the effect itself never calls setState
    // synchronously (same pattern as AsyncCombobox's own mount effect).
    const timer = setTimeout(() => {
      if (scope === "global") {
        setView(initialGlobalView);
        setLoadError(false);
        return;
      }
      loadView(scope);
    }, 0);
    return () => clearTimeout(timer);
  }, [scope, initialGlobalView, loadView]);

  async function handleAdd(event: FormEvent, type: string) {
    event.preventDefault();
    if (!selectedChannelId) return;
    setMutating(true);
    try {
      const response = await fetch("/api/insight-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: scope === "global" ? null : scope,
          insightType: type,
          channelId: Number(selectedChannelId),
        }),
      });
      if (response.ok) {
        await loadView(scope);
        setPendingType(null);
        setSelectedChannelId("");
      }
    } finally {
      setMutating(false);
    }
  }

  async function handleRemove(routeId: number) {
    setMutating(true);
    try {
      const response = await fetch(`/api/insight-routes?id=${routeId}`, { method: "DELETE" });
      if (response.ok) await loadView(scope);
    } finally {
      setMutating(false);
    }
  }

  const unmappedTypes = view.filter((t) => t.unmapped);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-foreground">Insight-type routing</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="routing-scope" className="text-sm font-medium text-foreground">
            Scope
          </label>
          <select
            id="routing-scope"
            value={scope === "global" ? "global" : String(scope)}
            onChange={(e) => setScope(e.target.value === "global" ? "global" : Number(e.target.value))}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <option value="global">Global default</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {unmappedTypes.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--status-warning-text)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning-text)]"
        >
          Unmapped insight type{unmappedTypes.length > 1 ? "s" : ""}:{" "}
          {unmappedTypes.map((t) => t.label).join(", ")} — insights of{" "}
          {unmappedTypes.length > 1 ? "these types" : "this type"} will not be delivered anywhere
          until mapped here or globally.
        </div>
      ) : null}

      {loadError ? (
        <p className="text-sm text-[var(--status-danger-text)]">
          Could not load the routing map for this scope.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {view.map((row) => (
          <div key={row.type} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{row.label}</h3>
              {row.unmapped ? (
                <span className="text-xs font-medium text-[var(--status-warning-text)]">
                  Unmapped
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {row.ownRoutes.map((rc) => (
                <span
                  key={rc.routeId}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--status-neutral-bg)] px-3 py-1 text-xs text-[var(--status-neutral-text)]"
                >
                  {rc.channelType === "slack_channel" ? "Slack" : "Drive"}: {rc.displayName}
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => handleRemove(rc.routeId)}
                      disabled={mutating}
                      aria-label={`Remove ${rc.displayName} from ${row.label}`}
                      className="text-[var(--status-neutral-text)] hover:text-[var(--status-danger-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
              {row.ownRoutes.length === 0 && row.globalRoutes.length > 0
                ? row.globalRoutes.map((rc) => (
                    <span
                      key={rc.routeId}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted"
                    >
                      Inherits global: {rc.channelType === "slack_channel" ? "Slack" : "Drive"}{" "}
                      {rc.displayName}
                    </span>
                  ))
                : null}
              {row.ownRoutes.length === 0 && row.globalRoutes.length === 0 ? (
                <span className="text-sm text-muted">No channel mapped.</span>
              ) : null}
            </div>

            {isAdmin ? (
              pendingType === row.type ? (
                <form
                  onSubmit={(e) => handleAdd(e, row.type)}
                  className="flex flex-wrap items-center gap-2"
                >
                  <label className="sr-only" htmlFor={`channel-for-${row.type}`}>
                    Channel to map to {row.label}
                  </label>
                  <select
                    id={`channel-for-${row.type}`}
                    value={selectedChannelId}
                    onChange={(e) => setSelectedChannelId(e.target.value)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    <option value="">Choose a channel…</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.type === "slack_channel" ? "Slack" : "Drive"}: {c.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={mutating || !selectedChannelId}
                    className="rounded-md bg-[var(--button-primary-bg)] px-3 py-2 text-xs font-medium text-[var(--button-primary-text)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingType(null);
                      setSelectedChannelId("");
                    }}
                    className="rounded-md border border-[var(--button-secondary-border)] px-3 py-2 text-xs font-medium text-[var(--button-secondary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setPendingType(row.type)}
                    disabled={channels.length === 0}
                    className="rounded-md border border-[var(--button-secondary-border)] px-3 py-1 text-xs font-medium text-[var(--button-secondary-text)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    + Map a channel
                  </button>
                </div>
              )
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
