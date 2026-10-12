import { asc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { evidence } from "@/src/db/schema";
import { parseCompactReport } from "@/src/lib/parseCompactReport";

export { parseCompactReport } from "@/src/lib/parseCompactReport";
export type { ParsedEvidenceItem } from "@/src/lib/parseCompactReport";

export type EvidenceRow = {
  id: number;
  runId: number;
  source: string;
  externalId: string;
  url: string | null;
  authorHandle: string | null;
  publishedAt: Date | null;
  textSnippet: string | null;
  engagementJson: unknown;
  retrievedAt: Date;
  sensitivityFlag: boolean | null;
};

/** Idempotent: a re-parse of the same report inserts nothing new, relying on
 * the `(run_id, source, external_id)` uniqueness constraint (T4). */
export async function storeEvidenceForRun(runId: number, stdout: string): Promise<number> {
  const items = parseCompactReport(stdout);
  if (items.length === 0) return 0;

  const inserted = await db
    .insert(evidence)
    .values(
      items.map((item) => ({
        runId,
        source: item.source,
        externalId: item.externalId,
        url: item.url,
        authorHandle: item.authorHandle,
        publishedAt: item.publishedAt,
        textSnippet: item.textSnippet,
        engagementJson: item.engagementJson,
      })),
    )
    .onConflictDoNothing({ target: [evidence.runId, evidence.source, evidence.externalId] })
    .returning({ id: evidence.id });

  return inserted.length;
}

export async function listEvidenceForRun(runId: number): Promise<EvidenceRow[]> {
  const rows = await db
    .select()
    .from(evidence)
    .where(eq(evidence.runId, runId))
    .orderBy(asc(evidence.source), asc(evidence.id));
  return rows;
}
