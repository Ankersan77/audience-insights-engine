import { eq, inArray } from "drizzle-orm";
import { db } from "@/src/db/client";
import { brand, brandMarket, market, researchInstruction } from "@/src/db/schema";

export type BrandReadiness =
  | "ready to run"
  | "not ready — no research instructions";

export type BrandListRow = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  marketCodes: string[];
  readiness: BrandReadiness;
};

export type MarketOption = { id: number; code: string; name: string; processingEnabled: boolean };

// Seeded only if the `market` reference table is empty, per T13's approach
// ("seed a handful of markets like US, Greece if the table is empty").
// Greece is seeded with `processingEnabled: false` explicitly (T20 / spec
// §16, compliance blocking finding): on a database that already has a `market`
// table, drizzle/0002_add_market_processing_enabled.sql's data migration
// flips the existing Greece row instead; this keeps a brand-new database
// landing in the same disabled state without waiting on that migration to
// run against a not-yet-existing row.
const SEED_MARKETS: Array<{ code: string; name: string; processingEnabled?: boolean }> = [
  { code: "US", name: "United States" },
  { code: "GR", name: "Greece", processingEnabled: false },
  { code: "GB", name: "United Kingdom" },
  { code: "DK", name: "Denmark" },
  { code: "SE", name: "Sweden" },
];

export async function listMarkets(): Promise<MarketOption[]> {
  const existing = await db.select().from(market);
  if (existing.length > 0) {
    return existing.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      processingEnabled: m.processingEnabled,
    }));
  }
  const seeded = await db.insert(market).values(SEED_MARKETS).returning();
  return seeded.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    processingEnabled: m.processingEnabled,
  }));
}

/** One market by id — used by the run-trigger API to check `processing_enabled` (T20). */
export async function getMarketById(marketId: number): Promise<MarketOption | null> {
  const [row] = await db.select().from(market).where(eq(market.id, marketId));
  return row
    ? { id: row.id, code: row.code, name: row.name, processingEnabled: row.processingEnabled }
    : null;
}

export async function listBrands(): Promise<BrandListRow[]> {
  const brands = await db.select().from(brand);
  if (brands.length === 0) return [];

  const brandIds = brands.map((b) => b.id);

  const marketRows = await db
    .select({ brandId: brandMarket.brandId, code: market.code })
    .from(brandMarket)
    .innerJoin(market, eq(market.id, brandMarket.marketId))
    .where(inArray(brandMarket.brandId, brandIds));

  const instructionRows = await db
    .selectDistinct({ brandId: researchInstruction.brandId })
    .from(researchInstruction)
    .where(inArray(researchInstruction.brandId, brandIds));

  const marketsByBrand = new Map<number, string[]>();
  for (const row of marketRows) {
    const list = marketsByBrand.get(row.brandId) ?? [];
    list.push(row.code);
    marketsByBrand.set(row.brandId, list);
  }

  const brandIdsWithInstruction = new Set(instructionRows.map((r) => r.brandId));

  return brands.map((b) => {
    let readiness: BrandReadiness;
    if (!brandIdsWithInstruction.has(b.id)) {
      readiness = "not ready — no research instructions";
    } else {
      readiness = "ready to run";
    }
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      status: b.status,
      marketCodes: marketsByBrand.get(b.id) ?? [],
      readiness,
    };
  });
}

export async function createBrand(input: {
  name: string;
  slug: string;
  description: string | null;
  marketIds: number[];
  createdBy: number;
}) {
  const [created] = await db
    .insert(brand)
    .values({
      name: input.name,
      slug: input.slug,
      description: input.description,
      status: "active",
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    })
    .returning();

  if (input.marketIds.length > 0) {
    await db
      .insert(brandMarket)
      .values(input.marketIds.map((marketId) => ({ brandId: created.id, marketId })));
  }

  return created;
}

export async function getBrandById(brandId: number) {
  const [row] = await db.select().from(brand).where(eq(brand.id, brandId));
  return row ?? null;
}

/** Archive or unarchive — a status change, never a delete, so run/insight history is preserved. */
export async function setBrandStatus(
  brandId: number,
  status: "active" | "archived",
  updatedBy: number,
) {
  const before = await getBrandById(brandId);
  const [after] = await db
    .update(brand)
    .set({ status, updatedBy, updatedAt: new Date() })
    .where(eq(brand.id, brandId))
    .returning();
  return { before, after };
}
