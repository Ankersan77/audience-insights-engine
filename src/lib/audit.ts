import { db } from "@/src/db/client";
import { auditLog } from "@/src/db/schema";

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
