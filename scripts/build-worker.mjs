#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, version as esbuildVersion } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist");
const outputPath = resolve(outputDirectory, "worker.mjs");
const forbiddenInputs = [
  "src/workers/runQueue",
  "src/workers/runLast30Days",
  "src/workers/draftInsights",
  "src/workers/canonicalQueue",
  "src/monitoring/",
  "src/db/queries/monitoring",
  "src/db/queries/briefings",
  "vendor/last30days",
];

await mkdir(outputDirectory, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/workers/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outfile: outputPath,
  metafile: true,
  minify: false,
  sourcemap: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  write: false,
});

const inputPaths = Object.keys(result.metafile.inputs).sort();
for (const forbidden of forbiddenInputs) {
  if (inputPaths.some((path) => path.includes(forbidden))) {
    throw new Error(`worker bundle contains forbidden input: ${forbidden}`);
  }
}

const output = result.outputFiles.find((file) => file.path === outputPath);
if (!output) throw new Error("worker bundle output missing");
const source = output.text;
for (const forbidden of ["research-run", "vendor/last30days"]) {
  if (source.includes(forbidden)) throw new Error(`worker bundle contains forbidden runtime marker: ${forbidden}`);
}

const sha256 = createHash("sha256").update(output.contents).digest("hex");
const manifest = {
  schemaVersion: 1,
  entrypoint: "src/workers/index.ts",
  artifact: "worker.mjs",
  sha256,
  bytes: output.contents.byteLength,
  nodeTarget: "node24",
  esbuildVersion,
  allowedQueues: [
    "market-research-source-acquisition",
    "market-research-canonical-maintenance",
    "market-research-synthesis-maintenance",
  ],
  retiredSchedules: ["market-research-monitoring-scheduler"],
  inputs: inputPaths,
};

await writeFile(outputPath, output.contents);
await writeFile(resolve(outputDirectory, "worker-build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`worker-build: ${sha256} (${output.contents.byteLength} bytes, ${inputPaths.length} inputs)`);
