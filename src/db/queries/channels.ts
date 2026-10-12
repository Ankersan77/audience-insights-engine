import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { channel } from "@/src/db/schema";

// Necessary plumbing for T15/T16 (same precedent as T10-T14's db/client.ts,
// app/api/brands/route.ts, etc.): nothing read or wrote the `channel` table
// yet, even though both tasks name files that need to.

export type ChannelType = "slack_channel" | "drive_folder";

export type ChannelRow = {
  id: number;
  type: ChannelType;
  externalRef: string;
  displayName: string;
  createdAt: Date;
};

function toRow(row: typeof channel.$inferSelect): ChannelRow {
  return {
    id: row.id,
    type: row.type,
    externalRef: row.externalRef,
    displayName: row.displayName,
    createdAt: row.createdAt,
  };
}

export async function listAllChannels(): Promise<ChannelRow[]> {
  const rows = await db.select().from(channel).orderBy(channel.createdAt);
  return rows.map(toRow);
}

export async function getChannelById(id: number): Promise<ChannelRow | null> {
  const [row] = await db.select().from(channel).where(eq(channel.id, id));
  return row ? toRow(row) : null;
}

export class DuplicateChannelError extends Error {
  constructor(message = "This channel is already connected.") {
    super(message);
    this.name = "DuplicateChannelError";
  }
}

type PgErrorShape = { code?: string; constraint?: string; message?: string; cause?: unknown } | null;

/**
 * drizzle-orm 0.45.x wraps the real `pg` error one level down on `.cause` —
 * checking only the outer error's `.message` (as an earlier draft of this
 * function did) can miss a real constraint violation. Same fix as
 * `research_runs.ts`'s `isActiveRunConstraintViolation`, scoped to this
 * table's unique constraint.
 */
function isDuplicateChannelConstraintViolation(error: unknown): boolean {
  for (const candidate of [error, (error as PgErrorShape)?.cause]) {
    const pgError = candidate as PgErrorShape;
    if (!pgError) continue;
    if (pgError.code === "23505" && pgError.constraint === "channel_type_external_ref_unique") {
      return true;
    }
    if (pgError.message && /channel_type_external_ref_unique/.test(pgError.message)) {
      return true;
    }
  }
  return false;
}

/** Saving a Slack/Drive picker selection (T15/T16): `type='slack_channel'|'drive_folder'`, `external_ref` the Slack/Drive id, `display_name` the human-readable name. */
export async function createChannel(input: {
  type: ChannelType;
  externalRef: string;
  displayName: string;
  createdBy: number;
}): Promise<ChannelRow> {
  try {
    const [created] = await db
      .insert(channel)
      .values({
        type: input.type,
        externalRef: input.externalRef,
        displayName: input.displayName,
        createdBy: input.createdBy,
      })
      .returning();
    return toRow(created);
  } catch (error) {
    if (isDuplicateChannelConstraintViolation(error)) {
      throw new DuplicateChannelError();
    }
    throw error;
  }
}
