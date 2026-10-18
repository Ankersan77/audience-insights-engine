import { db } from "@/src/db/client";
import { governanceAudit } from "@/src/db/schema";
/** Canonical, client-scoped audit trail containing only redacted projections. */
export async function recordGovernanceAudit(input: {
  clientId: number;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await db.insert(governanceAudit).values({
    clientId: input.clientId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    redactedBeforeJson: input.before ?? null,
    redactedAfterJson: input.after ?? null,
  });
}
