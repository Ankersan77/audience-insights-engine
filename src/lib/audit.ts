import { db } from "@/src/db/client";
import { auditLog, governanceAudit } from "@/src/db/schema";

/**
 * Append-only audit trail. Called from every mutating admin API route
 * (brand, research instruction, channel, insight decision, ...). There is no
 * update or delete path exposed for `audit_log` anywhere in this codebase —
 * do not add one.
 */
export async function recordAudit(
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.insert(auditLog).values({
    userId,
    action,
    entityType,
    entityId,
    beforeJson: before === undefined ? null : before,
    afterJson: after === undefined ? null : after,
  });
}
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
