"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Present only on sortable columns; returns the value to compare on. */
  sortAccessor?: (row: T) => string | number;
  render: (row: T) => ReactNode;
};

export type DataTableStatus = "loading" | "error" | "success";

export type DataTableProps<T> = {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  status: DataTableStatus;
  emptyMessage?: string;
  errorMessage?: string;
  onRowActivate?: (row: T) => void;
};

type SortState = { key: string; direction: "asc" | "desc" };

/**
 * Shared table: sticky header, right-aligned numeric columns, client-side
 * column sorting, and keyboard-navigable rows (Up/Down/Home/End, Enter to
 * activate). `status` drives loading/error/success; an empty `rows` array
 * while `status === "success"` renders `emptyMessage`.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  status,
  emptyMessage = "Nothing here yet.",
  errorMessage = "Something went wrong loading this data.",
  onRowActivate,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortAccessor) return rows;
    const accessor = column.sortAccessor;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
      return sort.direction === "asc" ? result : -result;
    });
    return copy;
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  function focusRow(index: number) {
    rowRefs.current[index]?.focus();
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number, row: T) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(Math.min(index + 1, sortedRows.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(sortedRows.length - 1);
        break;
      case "Enter":
      case " ":
        if (onRowActivate) {
          event.preventDefault();
          onRowActivate(row);
        }
        break;
      default:
        break;
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="sticky top-0 z-10 bg-surface">
            {columns.map((column) => {
              const isSorted = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortAccessor
                      ? isSorted
                        ? sort!.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  className={`border-b border-border px-3 py-2 font-semibold text-foreground ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.sortAccessor ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={`inline-flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                        column.align === "right" ? "flex-row-reverse" : ""
                      }`}
                    >
                      {column.header}
                      <span aria-hidden="true" className="text-xs text-muted">
                        {isSorted ? (sort!.direction === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {status === "loading" ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                Loading…
              </td>
            </tr>
          ) : status === "error" ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-[var(--status-danger-text)]"
              >
                {errorMessage}
              </td>
            </tr>
          ) : sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, index) => (
              <tr
                key={getRowId(row)}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                tabIndex={0}
                onKeyDown={(event) => handleRowKeyDown(event, index, row)}
                onClick={onRowActivate ? () => onRowActivate(row) : undefined}
                className={`border-b border-border last:border-b-0 ${
                  onRowActivate ? "cursor-pointer" : ""
                } hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 ${
                      column.align === "right" ? "text-right tabular-nums" : "text-left"
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
