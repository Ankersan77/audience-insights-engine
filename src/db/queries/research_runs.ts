import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/src/db/client";
import { brand, market, researchRun } from "@/src/db/schema";

// Necessary plumbing for T20/T21 (same precedent as src/db/queries/brands.ts,
// channels.ts, research_instructions.ts): nothing yet read or wrote the
// `research_run` table even though both tasks' named files depend on it.

export type ResearchRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ResearchRunRow = {
  id: number;
  brandId: number;
  marketId: number | null;
  researchInstructionVersion: number;
  triggeredBy: number;
  status: ResearchRunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
  errorMessage: string | null;
};

export type RunListRow = ResearchRunRow & {
  brandName: string;
  marketCode: string | null;
};

function toRow(row: typeof researchRun.$inferSelect): ResearchRunRow {
  return {
    id: row.id,
    brandId: row.brandId,
    marketId: row.marketId,
    researchInstructionVersion: row.researchInstructionVersion,
    triggeredBy: row.triggeredBy,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    timedOutAt: row.timedOutAt,
    errorMessage: row.errorMessage,
  };
}

/** The database rejected a second active (`queued`/`running`) Run for the same
 * brand+market via `research_run_active_brand_market_unique` (T4) — a 409, not a 500. */
export class DuplicateActiveRunError extends Error {
  constructor(message = "A run is already in progress for this brand and market.") {
    super(message);
    this.name = "DuplicateActiveRunError";
  }
}

type PgErrorShape = { code?: string; constraint?: string; message?: string; cause?: unknown };

/** drizzle-orm (0.45.x) wraps the underlying `pg` `DatabaseError` in its own
 * `DrizzleQueryError`, with the real `code`/`constraint` fields one level
 * down on `.cause` rather than on the error drizzle throws — confirmed live
 * against the actual thrown shape, not assumed. Checks both levels. */
function isActiveRunConstraintViolation(error: unknown): boolean {
  for (const candidate of [error, (error as PgErrorShape | null)?.cause]) {
    const pgError = candidate as PgErrorShape | null;
    if (!pgError) continue;
    if (pgError.code === "23505" && pgError.constraint === "research_run_active_brand_market_unique") {
      return true;
    }
    if (pgError.message && /research_run_active_brand_market_unique/.test(pgError.message)) {
      return true;
    }
  }
  return false;
}

/** Inserts a new `queued` Run. Relies on T4's partial unique index — never a
 * SELECT-then-INSERT check, which would race under concurrent triggers. */
export async function createQueuedRun(input: {
  brandId: number;
  marketId: number;
  researchInstructionVersion: number;
  triggeredBy: number;
}): Promise<ResearchRunRow> {
  try {
    const [created] = await db
      .insert(researchRun)
      .values({
        brandId: input.brandId,
        marketId: input.marketId,
        researchInstructionVersion: input.researchInstructionVersion,
        triggeredBy: input.triggeredBy,
        status: "queued",
      })
      .returning();
    return toRow(created);
  } catch (error) {
    if (isActiveRunConstraintViolation(error)) {
      throw new DuplicateActiveRunError();
    }
    throw error;
  }
}

export async function getRunById(id: number): Promise<ResearchRunRow | null> {
  const [row] = await db.select().from(researchRun).where(eq(researchRun.id, id));
  return row ? toRow(row) : null;
}

/** Run history, newest first, joined to brand name and market code (T21). */
export async function listRuns(): Promise<RunListRow[]> {
  const rows = await db
    .select({
      run: researchRun,
      brandName: brand.name,
      marketCode: market.code,
    })
    .from(researchRun)
    .innerJoin(brand, eq(brand.id, researchRun.brandId))
    .leftJoin(market, eq(market.id, researchRun.marketId))
    .orderBy(desc(researchRun.id));

  return rows.map((r) => ({ ...toRow(r.run), brandName: r.brandName, marketCode: r.marketCode }));
}

export async function markRunRunning(id: number): Promise<void> {
  await db
    .update(researchRun)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(researchRun.id, id));
}

export async function markRunSucceeded(id: number): Promise<void> {
  await db
    .update(researchRun)
    .set({ status: "succeeded", finishedAt: new Date() })
    .where(eq(researchRun.id, id));
}

export async function markRunFailed(
  id: number,
  errorMessage: string,
  options: { timedOut?: boolean } = {},
): Promise<void> {
  await db
    .update(researchRun)
    .set({
      status: "failed",
      finishedAt: new Date(),
      errorMessage,
      timedOutAt: options.timedOut ? new Date() : undefined,
    })
    .where(eq(researchRun.id, id));
}

/** The UI's "Cancel" action on a `queued`/`running` Run (T21, advisory). Marks the
 * row `cancelled` only from those two states; a terminal Run is left untouched.
 * This does not interrupt a worker process already running the subprocess — see
 * docs/runbook.md and the T21 report for that explicit, out-of-scope limitation. */
export async function cancelRun(id: number): Promise<ResearchRunRow | null> {
  const [updated] = await db
    .update(researchRun)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(researchRun.id, id), inArray(researchRun.status, ["queued", "running"])))
    .returning();
  return updated ? toRow(updated) : null;
}
