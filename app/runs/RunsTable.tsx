"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/src/components/DataTable";
import { StatusBadge, type Status } from "@/src/components/StatusBadge";
import type { RunListRow } from "@/src/db/queries/research_runs";
import { CancelRunButton } from "./CancelRunButton";

type Props = {
  runs: RunListRow[];
  /** Server-resolved role (T11): Cancel is a mutating action, so it is
   * omitted entirely for a viewer, never rendered-then-disabled. */
  isAdmin: boolean;
};

export function RunsTable({ runs, isAdmin }: Props) {
  const columns: DataTableColumn<RunListRow>[] = [
    {
      key: "id",
      header: "Run",
      sortAccessor: (row) => row.id,
      render: (row) => (
        <Link href={`/runs/${row.id}`} className="font-medium text-[var(--accent)] underline">
          #{row.id}
        </Link>
      ),
    },
    { key: "brand", header: "Brand", sortAccessor: (row) => row.brandName, render: (row) => row.brandName },
    {
      key: "market",
      header: "Market",
      render: (row) => row.marketCode ?? "—",
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status as Status} />,
    },
    {
      key: "version",
      header: "Instruction v",
      render: (row) => <span className="tabular-nums">{row.researchInstructionVersion}</span>,
    },
    {
      key: "error",
      header: "Error",
      render: (row) =>
        row.errorMessage ? (
          <span className="text-sm text-[var(--status-danger-text)]">{row.errorMessage}</span>
        ) : (
          "—"
        ),
    },
    ...(isAdmin
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (row: RunListRow) => <CancelRunButton runId={row.id} status={row.status} />,
          } satisfies DataTableColumn<RunListRow>,
        ]
      : []),
  ];

  return (
    <DataTable
      caption="Runs"
      columns={columns}
      rows={runs}
      getRowId={(row) => String(row.id)}
      status="success"
      emptyMessage="No runs yet — trigger one from a ready brand."
    />
  );
}
