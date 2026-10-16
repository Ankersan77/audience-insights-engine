"use client";

import { useState } from "react";
import { DataTable, type DataTableColumn } from "@/src/components/DataTable";
import type { BrandListRow, MarketOption } from "@/src/db/queries/brands";

type Props = {
  initialBrands: BrandListRow[];
  markets: MarketOption[];
  /** Server-resolved role (T11): admin-only controls are omitted entirely for a viewer, never rendered-then-disabled. */
  isAdmin: boolean;
};

const READINESS_TOKEN: Record<BrandListRow["readiness"], string> = {
  "ready to run": "text-[var(--status-success-text)]",
  "not ready — no research instructions": "text-muted",
};

/**
 * Client half of `/brands`: the shared `DataTable` plus the create-brand form
 * and the archive/unarchive action. The server component (`page.tsx`) does
 * the session check and the initial data fetch; this component only talks to
 * `/api/brands`, which re-checks the role server-side on every write.
 */
export function BrandsTable({ initialBrands, markets, isAdmin }: Props) {
  const [brands, setBrands] = useState(initialBrands);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMarketIds, setSelectedMarketIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMarket(id: number) {
    setSelectedMarketIds((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    );
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, marketIds: selectedMarketIds }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not create the brand.");
        return;
      }
      setBrands((current) => [
        ...current,
        {
          id: data.brand.id,
          name: data.brand.name,
          slug: data.brand.slug,
          description: data.brand.description,
          status: data.brand.status,
          marketCodes: markets
            .filter((m) => selectedMarketIds.includes(m.id))
            .map((m) => m.code),
          readiness: "not ready — no research instructions",
        },
      ]);
      setName("");
      setDescription("");
      setSelectedMarketIds([]);
      setFormOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(row: BrandListRow) {
    const nextStatus = row.status === "archived" ? "active" : "archived";
    const response = await fetch(`/api/brands/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!response.ok) return;
    const data = await response.json();
    setBrands((current) =>
      current.map((b) => (b.id === row.id ? { ...b, status: data.brand.status } : b)),
    );
  }

  const columns: DataTableColumn<BrandListRow>[] = [
    { key: "name", header: "Name", sortAccessor: (row) => row.name, render: (row) => row.name },
    { key: "slug", header: "Slug", render: (row) => row.slug },
    {
      key: "markets",
      header: "Markets",
      render: (row) => (row.marketCodes.length > 0 ? row.marketCodes.join(", ") : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <span className="capitalize">{row.status}</span>,
    },
    {
      key: "readiness",
      header: "Readiness",
      render: (row) => (
        <span className={`text-sm ${READINESS_TOKEN[row.readiness]}`}>{row.readiness}</span>
      ),
    },
    ...(isAdmin
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (row: BrandListRow) => (
              <button
                type="button"
                onClick={() => handleToggleStatus(row)}
                className="rounded-md border border-[var(--button-secondary-border)] px-2 py-1 text-xs font-medium text-[var(--button-secondary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {row.status === "archived" ? "Unarchive" : "Archive"}
              </button>
            ),
          } satisfies DataTableColumn<BrandListRow>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? (
        <div>
          {!formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              Add brand
            </button>
          ) : (
            <form
              onSubmit={handleCreate}
              className="flex flex-col gap-4 rounded-lg border border-border p-4"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="brand-name" className="text-sm font-medium text-foreground">
                  Name
                </label>
                <input
                  id="brand-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="brand-description" className="text-sm font-medium text-foreground">
                  Description
                </label>
                <textarea
                  id="brand-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-foreground">Markets</legend>
                <div className="flex flex-wrap gap-3">
                  {markets.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={selectedMarketIds.includes(m.id)}
                        onChange={() => toggleMarket(m.id)}
                        className="h-4 w-4"
                      />
                      {m.name} ({m.code})
                    </label>
                  ))}
                </div>
              </fieldset>
              {error ? (
                <p className="text-sm text-[var(--status-danger-text)]">{error}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {submitting ? "Creating…" : "Create brand"}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-md border border-[var(--button-secondary-border)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      <DataTable
        caption="Brands"
        columns={columns}
        rows={brands}
        getRowId={(row) => String(row.id)}
        status="success"
        emptyMessage="No brands yet — add one to get started."
      />
    </div>
  );
}
