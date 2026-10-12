/**
 * Manual proof that `runLast30Days` actually invokes the vendored Python
 * engine and gets real data back from the live, keyless Reddit path —
 * no mock, no fixture (T19, Epic E6).
 *
 * Run with: pnpm tsx scripts/smoke-last30days.ts
 */

import { runLast30Days } from "../src/workers/runLast30Days";

async function main() {
  const startedAt = Date.now();
  console.log("[smoke] invoking runLast30Days against live, keyless Reddit...");

  const result = await runLast30Days({
    subreddits: ["test"],
    dedicatedSubreddits: [],
    xHandle: null,
    xRelated: [],
    tiktokHashtags: [],
    topic: "test",
  });

  console.log(`[smoke] status: ${result.status}`);
  console.log(`[smoke] exit code: ${result.exitCode}`);
  console.log(`[smoke] duration: ${result.durationMs}ms (wall clock: ${Date.now() - startedAt}ms)`);
  console.log(`[smoke] stdout length: ${result.stdout.length} chars`);
  if (result.stderr) {
    console.log(`[smoke] stderr (first 2000 chars):\n${result.stderr.slice(0, 2000)}`);
  }

  if (result.status !== "completed" || result.exitCode !== 0) {
    console.error("[smoke] FAIL — did not complete successfully within the timeout.");
    process.exitCode = 1;
    return;
  }

  if (result.stdout.trim().length === 0) {
    console.error("[smoke] FAIL — process exited 0 but produced no stdout.");
    process.exitCode = 1;
    return;
  }

  console.log("[smoke] PASS — real output received within the timeout. First 3000 chars:\n");
  console.log(result.stdout.slice(0, 3000));
}

main().catch((err) => {
  console.error("[smoke] unexpected error:", err);
  process.exitCode = 1;
});
