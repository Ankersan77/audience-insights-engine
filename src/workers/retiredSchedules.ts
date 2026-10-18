import type { PgBoss } from "pg-boss";

/** Idempotent cutover cleanup using the public pg-boss API. Queue history is preserved. */
export const REMOVED_SCHEDULES = ["market-research-monitoring-scheduler"] as const;

export async function retireRemovedSchedules(boss: Pick<PgBoss, "unschedule">): Promise<void> {
  for (const name of REMOVED_SCHEDULES) await boss.unschedule(name);
}
