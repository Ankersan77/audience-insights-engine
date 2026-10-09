import { eq, isNull } from "drizzle-orm";
import { db } from "@/src/db/client";
import { channel, insightRoute } from "@/src/db/schema";
import { getChannelById } from "@/src/db/queries/channels";

/**
 * The six Insight Types (spec §11) a routing map can target. Not stored as a
 * DB enum (`insight.insight_type`/`insight_route.insight_type` are plain
 * `text`, per schema.ts), so the fixed set is named once here.
 */
export const INSIGHT_TYPES = [
  { value: "competitive-intel", label: "Competitive intel" },
  { value: "user-sentiment", label: "User sentiment" },
  { value: "market-trend", label: "Market trend" },
  { value: "brand-mention", label: "Brand mention" },
  { value: "regulatory-risk", label: "Regulatory risk" },
  { value: "other", label: "Other" },
] as const;

export type InsightTypeValue = (typeof INSIGHT_TYPES)[number]["value"];

export function isInsightType(value: unknown): value is InsightTypeValue {
  return INSIGHT_TYPES.some((t) => t.value === value);
}

export type RouteChannel = {
  routeId: number;
  channelId: number;
  channelType: "slack_channel" | "drive_folder";
  displayName: string;
};

export type TypeScopeView = {
  type: InsightTypeValue;
  label: string;
  /** Routes defined directly at the requested scope (this brand, or global). */
  ownRoutes: RouteChannel[];
  /**
   * The global default routes for this type — only populated when the
   * requested scope is a specific brand (FR8's fallback). Empty for the
   * global scope itself.
   */
  globalRoutes: RouteChannel[];
  /** No mapping at all for this type, checking both this scope and the global fallback (FR8). */
  unmapped: boolean;
};

type JoinedRouteRow = {
  id: number;
  brandId: number | null;
  insightType: string;
  channelId: number;
  channelType: "slack_channel" | "drive_folder";
  channelDisplayName: string;
};

function toRouteChannel(row: JoinedRouteRow): RouteChannel {
  return {
    routeId: row.id,
    channelId: row.channelId,
    channelType: row.channelType,
    displayName: row.channelDisplayName,
  };
}

/** Routes defined directly at this exact scope (`brand_id = brandId`, `null` = global) — no fallback applied. */
async function listRoutesForScope(brandId: number | null): Promise<JoinedRouteRow[]> {
  return db
    .select({
      id: insightRoute.id,
      brandId: insightRoute.brandId,
      insightType: insightRoute.insightType,
      channelId: insightRoute.channelId,
      channelType: channel.type,
      channelDisplayName: channel.displayName,
    })
    .from(insightRoute)
    .innerJoin(channel, eq(channel.id, insightRoute.channelId))
    .where(brandId === null ? isNull(insightRoute.brandId) : eq(insightRoute.brandId, brandId));
}

/**
 * Everything the routing-map screen needs for one scope: every Insight Type,
 * its own mapping at this scope, the global fallback (for a brand scope), and
 * whether it is unmapped overall — the FR8 "unmapped Insight Type" warning
 * (checking both brand-specific and global, same fallback `listBrands()`
 * already uses for brand readiness).
 */
export async function getScopeView(brandId: number | null): Promise<TypeScopeView[]> {
  const ownRows = await listRoutesForScope(brandId);
  const globalRows = brandId === null ? [] : await listRoutesForScope(null);

  return INSIGHT_TYPES.map(({ value, label }) => {
    const ownRoutes = ownRows.filter((r) => r.insightType === value).map(toRouteChannel);
    const globalRoutes = globalRows.filter((r) => r.insightType === value).map(toRouteChannel);
    return {
      type: value,
      label,
      ownRoutes,
      globalRoutes,
      unmapped: ownRoutes.length === 0 && globalRoutes.length === 0,
    };
  });
}

/** Insight Types with no mapping anywhere (global scope) — used by Brands' readiness check and available for reuse. */
export async function listGloballyUnmappedTypes(): Promise<InsightTypeValue[]> {
  const view = await getScopeView(null);
  return view.filter((t) => t.unmapped).map((t) => t.type);
}

export async function getInsightRouteById(id: number): Promise<RouteChannel & { brandId: number | null; insightType: string } | null> {
  const [row] = await db
    .select({
      id: insightRoute.id,
      brandId: insightRoute.brandId,
      insightType: insightRoute.insightType,
      channelId: insightRoute.channelId,
      channelType: channel.type,
      channelDisplayName: channel.displayName,
    })
    .from(insightRoute)
    .innerJoin(channel, eq(channel.id, insightRoute.channelId))
    .where(eq(insightRoute.id, id));
  if (!row) return null;
  return { ...toRouteChannel(row), brandId: row.brandId, insightType: row.insightType };
}

/**
 * Maps an Insight Type to a Channel, globally (`brandId: null`) or for one
 * Brand (T17). Idempotent: re-mapping the same type+channel at the same scope
 * returns the existing row rather than inserting a duplicate.
 */
export async function addInsightRoute(input: {
  brandId: number | null;
  insightType: InsightTypeValue;
  channelId: number;
}): Promise<{ routeId: number; brandId: number | null; insightType: string; channelId: number }> {
  const existing = await listRoutesForScope(input.brandId);
  const duplicate = existing.find(
    (r) => r.insightType === input.insightType && r.channelId === input.channelId,
  );
  if (duplicate) {
    return { routeId: duplicate.id, brandId: input.brandId, insightType: input.insightType, channelId: input.channelId };
  }

  const channelRow = await getChannelById(input.channelId);
  if (!channelRow) {
    throw new Error("That channel no longer exists.");
  }

  const [created] = await db
    .insert(insightRoute)
    .values({
      brandId: input.brandId,
      insightType: input.insightType,
      channelId: input.channelId,
    })
    .returning();

  return { routeId: created.id, brandId: created.brandId, insightType: created.insightType, channelId: created.channelId };
}

export async function removeInsightRoute(id: number): Promise<void> {
  await db.delete(insightRoute).where(eq(insightRoute.id, id));
}
