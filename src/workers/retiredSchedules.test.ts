import assert from "node:assert/strict";
import test from "node:test";
import { REMOVED_SCHEDULES, retireRemovedSchedules } from "./retiredSchedules.ts";

test("removed schedules are retired idempotently through pg-boss", async () => {
  const calls: string[] = [];
  const boss = { async unschedule(name: string) { calls.push(name); } };
  await retireRemovedSchedules(boss);
  await retireRemovedSchedules(boss);
  assert.deepEqual(REMOVED_SCHEDULES, ["market-research-monitoring-scheduler"]);
  assert.deepEqual(calls, ["market-research-monitoring-scheduler", "market-research-monitoring-scheduler"]);
});
