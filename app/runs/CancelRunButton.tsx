"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResearchRunStatus } from "@/src/db/queries/research_runs";

/**
 * "Cancel" action for a `queued`/`running` Run (T21, tech/UX review
 * advisory). Marks the row `cancelled` only — it does not interrupt a
 * subprocess already running in the worker process; see the API route's doc
 * comment and the T21 report for that explicit limitation.
 */
export function CancelRunButton({ runId, status }: { runId: number; status: ResearchRunStatus }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  if (status !== "queued" && status !== "running") return null;

  async function handleCancel() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCancel}
      disabled={submitting}
      className="rounded-md border border-[var(--button-secondary-border)] px-2 py-1 text-xs font-medium text-[var(--button-secondary-text)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      {submitting ? "Cancelling…" : "Cancel"}
    </button>
  );
}
