"use client";

import { useState } from "react";
import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { DataTable, type DataTableColumn } from "@/src/components/DataTable";
import { AsyncCombobox, type ComboboxOption } from "@/src/components/AsyncCombobox";
import { ConfirmDialog } from "@/src/components/ConfirmDialog";
import { StatusBadge, ALL_STATUSES } from "@/src/components/StatusBadge";

type SampleRun = {
  id: string;
  brand: string;
  market: string;
  evidenceCount: number;
};

const SAMPLE_RUNS: SampleRun[] = [
  { id: "r1", brand: "Casumo", market: "Sweden", evidenceCount: 42 },
  { id: "r2", brand: "LeoVegas", market: "Denmark", evidenceCount: 17 },
  { id: "r3", brand: "Mr Green", market: "Greece", evidenceCount: 5 },
];

const RUN_COLUMNS: DataTableColumn<SampleRun>[] = [
  { key: "brand", header: "Brand", render: (row) => row.brand },
  { key: "market", header: "Market", render: (row) => row.market },
  {
    key: "evidenceCount",
    header: "Evidence",
    align: "right",
    sortAccessor: (row) => row.evidenceCount,
    render: (row) => row.evidenceCount,
  },
];

const SAMPLE_CHANNELS: ComboboxOption[] = [
  { id: "c1", label: "#casumo-sweden-insights", description: "Slack · Casumo" },
  { id: "c2", label: "#leovegas-denmark-insights", description: "Slack · LeoVegas" },
  { id: "c3", label: "#mrgreen-greece-insights", description: "Slack · Mr Green" },
];

async function searchChannels(query: string): Promise<ComboboxOption[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return SAMPLE_CHANNELS.filter((option) =>
    option.label.toLowerCase().includes(query.toLowerCase()),
  );
}

function neverResolves(): Promise<ComboboxOption[]> {
  return new Promise(() => {});
}

async function alwaysEmpty(): Promise<ComboboxOption[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return [];
}

async function alwaysErrors(): Promise<ComboboxOption[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  throw new Error("demo failure");
}

function noop() {
  // Showroom demos don't wire up real navigation/selection handlers.
}

export default function ShowroomPage() {
  const [dialog, setDialog] = useState<"none" | "default" | "destructive">("none");

  return (
    <AppShell>
      <PageHeader
        title="Showroom"
        description="Every shared component, in every state it can be in. Screens are assembled from these and nothing else."
      />

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-semibold text-foreground">DataTable</h2>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted uppercase">Loading</h3>
          <DataTable
            caption="Runs (loading)"
            columns={RUN_COLUMNS}
            rows={[]}
            getRowId={(row) => row.id}
            status="loading"
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted uppercase">Empty</h3>
          <DataTable
            caption="Runs (empty)"
            columns={RUN_COLUMNS}
            rows={[]}
            getRowId={(row) => row.id}
            status="success"
            emptyMessage="No runs yet — trigger one from a brand page."
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted uppercase">Error</h3>
          <DataTable
            caption="Runs (error)"
            columns={RUN_COLUMNS}
            rows={[]}
            getRowId={(row) => row.id}
            status="error"
            errorMessage="Couldn't load runs. Try again."
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted uppercase">
            Success — sortable columns, keyboard-navigable rows (Up/Down/Home/End, Enter)
          </h3>
          <DataTable
            caption="Runs"
            columns={RUN_COLUMNS}
            rows={SAMPLE_RUNS}
            getRowId={(row) => row.id}
            status="success"
            onRowActivate={noop}
          />
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">AsyncCombobox</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <AsyncCombobox
            label="Loading demo"
            placeholder="Search channels…"
            search={neverResolves}
            onSelect={noop}
            initialQuery="lo"
          />
          <AsyncCombobox
            label="Empty demo"
            placeholder="Search channels…"
            search={alwaysEmpty}
            onSelect={noop}
            initialQuery="zzz"
          />
          <AsyncCombobox
            label="Error demo"
            placeholder="Search channels…"
            search={alwaysErrors}
            onSelect={noop}
            initialQuery="er"
          />
          <AsyncCombobox
            label="Success demo — type to search, arrow keys to move, Enter to select"
            placeholder="Search channels…"
            search={searchChannels}
            onSelect={noop}
            initialQuery="insights"
          />
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">StatusBadge</h2>
        <div className="flex flex-wrap gap-3">
          {ALL_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">ConfirmDialog</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setDialog("default")}
            className="rounded-md bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Open default dialog
          </button>
          <button
            type="button"
            onClick={() => setDialog("destructive")}
            className="rounded-md border border-[var(--button-secondary-border)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Open destructive dialog
          </button>
        </div>

        <ConfirmDialog
          open={dialog === "default"}
          title="Accept this insight?"
          body="It will be marked accepted and routed to its mapped Slack channel."
          confirmLabel="Accept"
          cancelLabel="Cancel"
          onConfirm={() => setDialog("none")}
          onCancel={() => setDialog("none")}
        />
        <ConfirmDialog
          open={dialog === "destructive"}
          title="Discard this insight?"
          body="This can't be undone. The insight will be marked discarded and removed from the queue."
          confirmLabel="Discard"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => setDialog("none")}
          onCancel={() => setDialog("none")}
        />
      </section>
    </AppShell>
  );
}
