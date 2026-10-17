/**
 * Standalone worker entry point (T20), started separately from the Next.js
 * app (`pnpm worker`) — its own process in the same container image (ADR
 * 0002), sharing the Postgres database via pg-boss.
 *
 * Loads `.env.local` with Node's built-in `process.loadEnvFile` (Node 20.12+,
 * stable here on Node 24 — no new dependency) for local dev convenience; in
 * the deployed container env vars come from the platform (SSM/k8s secrets)
 * and a missing `.env.local` is a silent no-op. Done via a dynamic `import()`
 * of the worker modules below, not static imports: static imports are hoisted
 * ahead of this file's own top-level code, which would make `src/db/client`
 * read `process.env.DATABASE_URL` before `.env.local` had a chance to set it.
 */

import path from "node:path";

try {
  process.loadEnvFile(path.join(process.cwd(), ".env.local"));
} catch {
  // No .env.local present — expected in the deployed container.
}

async function main() {
  const { assertClientOwnedDeployment } = await import("../lib/clientOwnedDeployment");
  await assertClientOwnedDeployment();
  const { getWorkerRuntime, installWorkerShutdown, runWorkerStartup } = await import("./pgBossRuntime");
  const { startRunWorker } = await import("./runQueue");
  const { startCanonicalWorkers } = await import("./canonicalWorkers");
  const { startMonitoringScheduler } = await import("./canonicalQueue");
  const { createProductionAdapterRegistry, createProductionRuntimeContext } = await import("../evidence/productionRegistry");
  const boss = await getWorkerRuntime();
  const shutdown = installWorkerShutdown(boss);
  const started = await runWorkerStartup([
    () => startRunWorker(boss),
    () => startCanonicalWorkers(boss, { registry: createProductionAdapterRegistry(), runtime: createProductionRuntimeContext() }),
    () => startMonitoringScheduler(boss),
  ], shutdown);
  if (started) {
    console.log(`[worker] subscribed to legacy, canonical and transitional-monitoring queues (pid ${process.pid})`);
  }
}

main().catch(() => {
  console.error("[worker] fatal-startup-error");
  process.exit(1);
});
