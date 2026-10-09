import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { appUser, brandMarket, market, researchInstruction } from "@/src/db/schema";

export type MarketScope = { id: number; code: string; name: string };

export type ResearchInstructionFields = {
  subreddits: string[];
  dedicatedSubreddits: string[];
  xHandle: string | null;
  xRelated: string[];
  tiktokHashtags: string[];
  competitors: string[];
  focusText: string | null;
};

export type ResearchInstructionRow = ResearchInstructionFields & {
  id: number;
  brandId: number;
  /** `null` is the brand-level default scope. */
  marketId: number | null;
  version: number;
  updatedBy: number;
  updatedAt: Date;
};

export type ResearchInstructionHistoryRow = ResearchInstructionRow & {
  updatedByName: string;
  updatedByEmail: string;
};

function toRow(row: typeof researchInstruction.$inferSelect): ResearchInstructionRow {
  return {
    id: row.id,
    brandId: row.brandId,
    marketId: row.marketId,
    version: row.version,
    subreddits: row.subreddits,
    dedicatedSubreddits: row.dedicatedSubreddits,
    xHandle: row.xHandle,
    xRelated: row.xRelated,
    tiktokHashtags: row.tiktokHashtags,
    competitors: row.competitors,
    focusText: row.focusText,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

function scopeCondition(marketId: number | null) {
  return marketId === null ? isNull(researchInstruction.marketId) : eq(researchInstruction.marketId, marketId);
}

/** The markets this brand runs in (`brand_market`) — the scope list for the per-market override rows on the editor. */
export async function listBrandMarkets(brandId: number): Promise<MarketScope[]> {
  return db
    .select({ id: market.id, code: market.code, name: market.name })
    .from(brandMarket)
    .innerJoin(market, eq(market.id, brandMarket.marketId))
    .where(eq(brandMarket.brandId, brandId))
    .orderBy(market.code);
}

/**
 * The latest (highest-version) row for every scope that currently has at
 * least one version: the brand-level default (key `null`) plus any market
 * that has been explicitly overridden. A market absent from this map has
 * never been overridden and inherits the brand-level default.
 */
export async function getLatestInstructionsForBrand(
  brandId: number,
): Promise<Map<number | null, ResearchInstructionRow>> {
  const rows = await db
    .select()
    .from(researchInstruction)
    .where(eq(researchInstruction.brandId, brandId))
    .orderBy(desc(researchInstruction.version));

  const latest = new Map<number | null, ResearchInstructionRow>();
  for (const row of rows) {
    if (!latest.has(row.marketId)) {
      latest.set(row.marketId, toRow(row));
    }
  }
  return latest;
}

/** Every past version for one brand/market scope, newest first, joined to its author. */
export async function getInstructionHistory(
  brandId: number,
  marketId: number | null,
): Promise<ResearchInstructionHistoryRow[]> {
  const rows = await db
    .select({
      instruction: researchInstruction,
      updatedByName: appUser.name,
      updatedByEmail: appUser.email,
    })
    .from(researchInstruction)
    .innerJoin(appUser, eq(appUser.id, researchInstruction.updatedBy))
    .where(and(eq(researchInstruction.brandId, brandId), scopeCondition(marketId)))
    .orderBy(desc(researchInstruction.version));

  return rows.map((r) => ({
    ...toRow(r.instruction),
    updatedByName: r.updatedByName,
    updatedByEmail: r.updatedByEmail,
  }));
}

/**
 * Saving never updates a row in place — versions are immutable history.
 * Computes the next version as max(version)+1 for this exact
 * brand_id+market_id scope (brand-level and each market version
 * independently), then inserts a brand-new row.
 */
export async function createInstructionVersion(input: {
  brandId: number;
  marketId: number | null;
  fields: ResearchInstructionFields;
  updatedBy: number;
}): Promise<ResearchInstructionRow> {
  const [{ maxVersion }] = await db
    .select({
      maxVersion: sql<number>`coalesce(max(${researchInstruction.version}), 0)`,
    })
    .from(researchInstruction)
    .where(and(eq(researchInstruction.brandId, input.brandId), scopeCondition(input.marketId)));

  const [created] = await db
    .insert(researchInstruction)
    .values({
      brandId: input.brandId,
      marketId: input.marketId,
      version: Number(maxVersion) + 1,
      subreddits: input.fields.subreddits,
      dedicatedSubreddits: input.fields.dedicatedSubreddits,
      xHandle: input.fields.xHandle,
      xRelated: input.fields.xRelated,
      tiktokHashtags: input.fields.tiktokHashtags,
      competitors: input.fields.competitors,
      focusText: input.fields.focusText,
      updatedBy: input.updatedBy,
    })
    .returning();

  return toRow(created);
}
