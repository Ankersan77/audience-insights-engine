/**
 * Standalone worker entry point (T20), started separately from the Next.js
 * app (`pnpm worker`) — its own process in the same container image (ADR
 * 0002), sharing the Postgres database via pg-boss.
 *
 * Loads `.env.local` with Node's built-in `process.loadEnvFile` (Node 20.12+,
 * stable here on Node 24 — no new dependency) for local dev convenience; in
 * the deployed container env vars come from the platform (SSM/k8s secrets)
 * and a missing `.env.local` is a silent no-op. Done via a dynamic `import()`
 * of `./runQueue` below, not a static import: a static import is hoisted
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
  const { startRunWorker } = await import("./runQueue");
  const { startCanonicalScheduler } = await import("./canonicalQueue");
  const { startSynthesisMaintenance } = await import("./synthesisMaintenance");
  const { startAcquisitionWorker } = await import("./acquisitionQueue");
  const { createProductionAdapterRegistry, createProductionRuntimeContext } = await import("../evidence/productionRegistry");
  const boss = await startRunWorker();
  await startAcquisitionWorker(boss, { registry: createProductionAdapterRegistry(), runtime: createProductionRuntimeContext() });
  await startCanonicalScheduler(boss);
  await startSynthesisMaintenance(boss);
  console.log(`[worker] subscribed to legacy, canonical scheduler, source-acquisition and synthesis-maintenance queues (pid ${process.pid})`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received — draining in-flight jobs before exit`);
    try {
      // Graceful stop: lets a job already in flight finish rather than
      // killing it mid-subprocess (devops review required finding). The
      // timeout is a safety margin over runLast30Days' own 10-minute hard
      // ceiling, not a second timeout racing it.
      await boss.stop({ graceful: true, timeout: 11 * 60 * 1000 });
      console.log("[worker] drained, exiting");
    } catch (error) {
      console.error("[worker] error while draining", error);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[worker] fatal error starting the worker", error);
  process.exit(1);
});
