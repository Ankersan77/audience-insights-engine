import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const REMOVED_LEGACY_PATHS = [
  ".gitmodules", "vendor/last30days", "scripts/smoke-last30days.ts",
  "src/workers/runLast30Days.ts", "src/workers/runQueue.ts", "src/workers/draftInsights.ts",
  "src/workers/purgeEvidence.ts", "src/workers/canonicalQueue.ts",
  "src/lib/featureFlags.ts", "src/lib/parseCompactReport.ts",
  "src/db/queries/brands.ts", "src/db/queries/research_instructions.ts",
  "src/db/queries/research_runs.ts", "src/db/queries/evidence.ts", "src/db/queries/insights.ts",
  "app/brands", "app/runs", "app/insights", "app/api/brands", "app/api/runs", "app/api/insights",
];

function read(root, path) {
  const fullPath = join(root, path);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

const ACTIVE_RUNTIME_ROOTS = ["app", "src", "scripts"];
const RUNTIME_SCAN_ALLOWLIST = new Set([
  "scripts/build-worker.mjs",
  "scripts/check-source-of-truth.mjs",
  "scripts/removed-runtime-guard.mjs",
  "scripts/validate-product-governance.mjs",
  "scripts/verify-production-images.mjs",
]);

function activeRuntimeFiles(root) {
  return ACTIVE_RUNTIME_ROOTS.flatMap((directory) => {
    const scanRoot = join(root, directory);
    if (!existsSync(scanRoot)) return [];
    return readdirSync(scanRoot, { recursive: true })
      .filter((path) => typeof path === "string" && /\.(?:ts|tsx|js|mjs)$/.test(path) && !/\.test\.[^.]+$/.test(path))
      .map((path) => `${directory}/${path}`)
      .filter((path) => !RUNTIME_SCAN_ALLOWLIST.has(path));
  });
}

export function validateRemovedRuntime(root) {
  const failures = [];
  for (const path of REMOVED_LEGACY_PATHS) {
    if (existsSync(join(root, path))) failures.push(`Removed legacy surface still exists: ${path}.`);
  }
  const workerEntry = read(root, "src/workers/index.ts");
  for (const marker of ["runQueue", "startRunWorker", "runLast30Days", "draftInsights", "canonicalQueue", "startMonitoringScheduler", "research-run"]) {
    if (workerEntry.includes(marker)) failures.push(`Canonical worker entry contains removed marker ${marker}.`);
  }
  if (/apk add[^\n]*python|vendor\/last30days/.test(read(root, "Dockerfile"))) {
    failures.push("Dockerfile must not install Python or copy the removed vendor engine.");
  }
  if (/^\s*submodules\s*:/m.test(read(root, ".github/workflows/ci.yml"))) {
    failures.push("CI must not fetch removed Git submodules.");
  }
  const environment = read(root, ".env.example");
  for (const variable of ["ENABLE_LEGACY_LAST30DAYS", "EVIDENCE_RETENTION_DAYS", "X_BEARER_TOKEN", "XAI_API_KEY", "SCRAPECREATORS_API_KEY", "ANTHROPIC_API_KEY"]) {
    if (environment.includes(variable)) failures.push(`.env.example advertises removed runtime variable ${variable}.`);
  }
  const runtimeSource = activeRuntimeFiles(root).map((path) => readFileSync(join(root, path), "utf8")).join("\n");
  if (runtimeSource.toLowerCase().includes("last30days")) failures.push("Active runtime contains removed last30days marker.");
  for (const marker of ["api.anthropic.com/v1/messages", "ANTHROPIC_API_KEY", "X_BEARER_TOKEN", "XAI_API_KEY", "SCRAPECREATORS_API_KEY"]) {
    if (runtimeSource.includes(marker)) failures.push(`Active runtime contains removed provider marker ${marker}.`);
  }
  return failures;
}
