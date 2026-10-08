import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/src/db/client";
import { brand, brandMarket, insightRoute, market, researchInstruction } from "@/src/db/schema";

export type BrandReadiness =
  | "ready to run"
  | "not ready — no research instructions"
  | "not ready — no channel mapped";

export type BrandListRow = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  marketCodes: string[];
  readiness: BrandReadiness;
};

export type MarketOption = { id: number; code: string; name: string };

// Seeded only if the `market` reference table is empty, per T13's approach
// ("seed a handful of markets like US, Greece if the table is empty").
const SEED_MARKETS: Array<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "GR", name: "Greece" },
  { code: "GB", name: "United Kingdom" },
  { code: "DK", name: "Denmark" },
  { code: "SE", name: "Sweden" },
];

export async function listMarkets(): Promise<MarketOption[]> {
  const existing = await db.select().from(market);
  if (existing.length > 0) {
    return existing.map((m) => ({ id: m.id, code: m.code, name: m.name }));
  }
  const seeded = await db.insert(market).values(SEED_MARKETS).returning();
  return seeded.map((m) => ({ id: m.id, code: m.code, name: m.name }));
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

  const brandRouteRows = await db
    .selectDistinct({ brandId: insightRoute.brandId })
    .from(insightRoute)
    .where(and(inArray(insightRoute.brandId, brandIds)));

  // A global mapping (insight_route.brand_id IS NULL) routes every brand's
  // insights of that type, so it counts toward every brand's readiness too.
  const [globalRoute] = await db
    .select({ id: insightRoute.id })
    .from(insightRoute)
    .where(isNull(insightRoute.brandId))
    .limit(1);

  const marketsByBrand = new Map<number, string[]>();
  for (const row of marketRows) {
    const list = marketsByBrand.get(row.brandId) ?? [];
    list.push(row.code);
    marketsByBrand.set(row.brandId, list);
  }

  const brandIdsWithInstruction = new Set(instructionRows.map((r) => r.brandId));
  const brandIdsWithRoute = new Set(
    brandRouteRows.map((r) => r.brandId).filter((id): id is number => id !== null),
  );

  return brands.map((b) => {
    let readiness: BrandReadiness;
    if (!brandIdsWithInstruction.has(b.id)) {
      readiness = "not ready — no research instructions";
    } else if (!globalRoute && !brandIdsWithRoute.has(b.id)) {
      readiness = "not ready — no channel mapped";
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
