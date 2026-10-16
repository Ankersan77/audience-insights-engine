import { and, desc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { brand, evidence, insight, insightEvidence, market } from "@/src/db/schema";

// Necessary plumbing for T22/T23 (same precedent as every prior epic's
// query modules): nothing yet read or wrote the `insight`/`insight_evidence`
// tables even though both tasks name files that need to.

export type InsightStatus = "pending" | "accepted" | "discarded";
export type ShiftOrBlip = "shift" | "blip";

/** The owned-product review queue has three explicit editorial states. */
export type QueueFilter = "pending" | "accepted" | "discarded";

export type InsightRow = {
  id: number;
  clientId: number;
  brandId: number;
  marketId: number | null;
  runId: number;
  insightType: string;
  title: string;
  summary: string;
  shiftOrBlip: ShiftOrBlip;
  confidence: number;
  status: InsightStatus;
  reviewedBy: number | null;
  reviewedAt: Date | null;
};

export type InsightListRow = InsightRow & {
  brandName: string;
  marketCode: string | null;
};

export type InsightEvidenceDetail = {
  id: number;
  source: string;
  externalId: string;
  url: string | null;
  textSnippet: string | null;
  sensitivityFlag: boolean | null;
};

function toRow(row: typeof insight.$inferSelect): InsightRow {
  return {
    id: row.id,
    clientId: row.clientId,
    brandId: row.brandId,
    marketId: row.marketId,
    runId: row.runId,
    insightType: row.insightType,
    title: row.title,
    summary: row.summary,
    shiftOrBlip: row.shiftOrBlip as ShiftOrBlip,
    confidence: row.confidence,
    status: row.status as InsightStatus,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
  };
}

/**
 * Creates one `insight` row and its linked `insight_evidence` rows (T22).
 * Sequential inserts, not a transaction — same style already established by
 * `createBrand` (brand + brand_market) elsewhere in this codebase.
 */
export async function createInsightWithEvidence(input: {
  clientId: number;
  brandId: number;
  marketId: number | null;
  runId: number;
  insightType: string;
  title: string;
  summary: string;
  shiftOrBlip: ShiftOrBlip;
  confidence: number;
  evidenceIds: number[];
}): Promise<InsightRow> {
  const [created] = await db
    .insert(insight)
    .values({
      clientId: input.clientId,
      brandId: input.brandId,
      marketId: input.marketId,
      runId: input.runId,
      insightType: input.insightType,
      title: input.title,
      summary: input.summary,
      shiftOrBlip: input.shiftOrBlip,
      confidence: input.confidence,
      status: "pending",
    })
    .returning();

  if (input.evidenceIds.length > 0) {
    await db
      .insert(insightEvidence)
      .values(input.evidenceIds.map((evidenceId) => ({ insightId: created.id, evidenceId })));
  }

  return toRow(created);
}

/** The global queue: every brand, filterable by review status. Newest first. */
export async function listInsights(filter: {
  clientId: number;
  queueFilter?: QueueFilter;
  brandId?: number;
}): Promise<InsightListRow[]> {
  const conditions = [eq(insight.clientId, filter.clientId)];
  if (filter.brandId) conditions.push(eq(insight.brandId, filter.brandId));
  if (filter.queueFilter) {
    conditions.push(eq(insight.status, filter.queueFilter));
  }

  const rows = await db
    .select({ insight, brandName: brand.name, marketCode: market.code })
    .from(insight)
    .innerJoin(brand, eq(brand.id, insight.brandId))
    .leftJoin(market, eq(market.id, insight.marketId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(insight.id));

  return rows.map((r) => ({ ...toRow(r.insight), brandName: r.brandName, marketCode: r.marketCode }));
}

export async function getInsightById(id: number, clientId: number): Promise<InsightRow | null> {
  const [row] = await db
    .select()
    .from(insight)
    .where(and(eq(insight.id, id), eq(insight.clientId, clientId)));
  return row ? toRow(row) : null;
}

/** Evidence linked to one insight (T23: surfaces `sensitivity_flag` per item in the review UI). */
export async function getInsightEvidence(insightId: number, clientId: number): Promise<InsightEvidenceDetail[]> {
  return db
    .select({
      id: evidence.id,
      source: evidence.source,
      externalId: evidence.externalId,
      url: evidence.url,
      textSnippet: evidence.textSnippet,
      sensitivityFlag: evidence.sensitivityFlag,
    })
    .from(insightEvidence)
    .innerJoin(insight, eq(insight.id, insightEvidence.insightId))
    .innerJoin(evidence, eq(evidence.id, insightEvidence.evidenceId))
    .where(and(eq(insightEvidence.insightId, insightId), eq(insight.clientId, clientId)));
}

/** Edits an Insight's title/summary before accepting (T23, UX review required finding 4). */
export async function updateInsightText(
  id: number,
  clientId: number,
  input: { title: string; summary: string },
): Promise<InsightRow | null> {
  const [updated] = await db
    .update(insight)
    .set({ title: input.title, summary: input.summary })
    .where(and(eq(insight.id, id), eq(insight.clientId, clientId)))
    .returning();
  return updated ? toRow(updated) : null;
}
/** Accept/discard decision (T23) — the review state, independent of delivery. */
export async function markInsightDecision(
  id: number,
  clientId: number,
  input: { status: "accepted" | "discarded"; reviewedBy: number },
): Promise<InsightRow | null> {
  const [updated] = await db
    .update(insight)
    .set({ status: input.status, reviewedBy: input.reviewedBy, reviewedAt: new Date() })
    .where(and(eq(insight.id, id), eq(insight.clientId, clientId)))
    .returning();
  return updated ? toRow(updated) : null;
}
