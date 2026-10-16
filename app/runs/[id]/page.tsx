import { notFound } from "next/navigation";
import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { StatusBadge, type Status } from "@/src/components/StatusBadge";
import { requireSession } from "@/src/lib/auth";
import { getBrandById, getMarketById } from "@/src/db/queries/brands";
import { getRunById } from "@/src/db/queries/research_runs";
import { listEvidenceForRun, type EvidenceRow } from "@/src/db/queries/evidence";
import { CancelRunButton } from "../CancelRunButton";
import { isAdmin } from "@/src/lib/roles";

export const dynamic = "force-dynamic";

function groupBySource(rows: EvidenceRow[]): Map<string, EvidenceRow[]> {
  const grouped = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.source) ?? [];
    list.push(row);
    grouped.set(row.source, list);
  }
  return grouped;
}

function formatEngagement(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, number>);
  if (entries.length === 0) return null;
  return entries.map(([label, count]) => `${count.toLocaleString()} ${label}`).join(" · ");
}

/** A `running` Run past its own 10-minute `runLast30Days` timeout, probably
 * because the worker crashed mid-run rather than the job itself still being
 * legitimately in flight (tech/UX review advisory). A plain helper, not
 * inlined in the component body: the lint rule for component purity flags a
 * bare `Date.now()` call inside a function component's own render. */
function isStaleRunningRun(run: { status: string; startedAt: Date | null }): boolean {
  return (
    run.status === "running" &&
    run.startedAt !== null &&
    Date.now() - run.startedAt.getTime() > 10 * 60 * 1000
  );
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const session = await requireSession(`/runs/${id}`);

  if (!Number.isInteger(runId)) {
    notFound();
  }

  const run = await getRunById(runId, session.clientId);
  if (!run) {
    notFound();
  }

  const [brand, market, evidenceRows] = await Promise.all([
    getBrandById(run.brandId, session.clientId),
    run.marketId !== null ? getMarketById(run.marketId) : Promise.resolve(null),
    listEvidenceForRun(runId),
  ]);

  const evidenceBySource = groupBySource(evidenceRows);
  const isStale = isStaleRunningRun(run);

  return (
    <AppShell user={session}>
      <PageHeader
        title={`Run #${run.id}`}
        description={`${brand?.name ?? "Unknown brand"} · ${market?.name ?? "No market"}`}
        actions={
          isAdmin(session) ? <CancelRunButton runId={run.id} status={run.status} /> : null
        }
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
          <StatusBadge status={run.status as Status} />
          <span className="text-sm text-muted">Research instruction v{run.researchInstructionVersion}</span>
          {run.startedAt ? (
            <span className="text-sm text-muted">Started {run.startedAt.toLocaleString()}</span>
          ) : null}
          {run.finishedAt ? (
            <span className="text-sm text-muted">Finished {run.finishedAt.toLocaleString()}</span>
          ) : null}
          {isStale ? (
            <span className="text-sm text-[var(--status-warning-text)]">
              Still running past its 10-minute timeout window — check the worker.
            </span>
          ) : null}
        </div>

        {run.errorMessage ? (
          <div className="rounded-lg border border-[var(--status-danger-text)] bg-[var(--status-danger-bg)] p-4 text-sm text-[var(--status-danger-text)]">
            {run.errorMessage}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">
            Evidence ({evidenceRows.length})
          </h2>
          {evidenceRows.length === 0 ? (
            <p className="text-sm text-muted">
              {run.status === "succeeded"
                ? "This run completed with no evidence items."
                : "No evidence yet."}
            </p>
          ) : (
            Array.from(evidenceBySource.entries()).map(([source, items]) => (
              <div key={source} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  {source} ({items.length})
                </h3>
                <ul className="flex flex-col gap-3">
                  {items.map((item) => {
                    const engagement = formatEngagement(item.engagementJson);
                    return (
                      <li key={item.id} className="rounded-lg border border-border p-3">
                        <p className="text-sm text-foreground">{item.textSnippet ?? "(no text)"}</p>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                          {item.publishedAt ? <span>{item.publishedAt.toLocaleDateString()}</span> : null}
                          {engagement ? <span>{engagement}</span> : null}
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--accent)] underline"
                            >
                              Source link
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
