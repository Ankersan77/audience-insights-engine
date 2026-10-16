#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const blueprint = readFileSync(new URL("../BLUEPRINT.md", import.meta.url), "utf8");
const roadmap = readFileSync(new URL("../ROADMAP.md", import.meta.url), "utf8");
const productSpec = readFileSync(new URL("../product-spec.md", import.meta.url), "utf8");
const implementationPlan = readFileSync(new URL("../implementation-plan.md", import.meta.url), "utf8");
const exampleEnvironment = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

const failures = [];
const versionMatch = blueprint.match(/^\| Blueprint version \|\s*([^|\n]+)\s*\|$/m);
if (!versionMatch) failures.push("BLUEPRINT.md must declare a Blueprint version table row.");
if (versionMatch && !roadmap.includes(`BLUEPRINT.md\` version ${versionMatch[1].trim()}`)) {
  failures.push("ROADMAP.md must reference the exact canonical blueprint version.");
}

for (const [name, contents, target] of [
  ["product-spec.md", productSpec, "BLUEPRINT.md"],
  ["implementation-plan.md", implementationPlan, "ROADMAP.md"],
]) {
  if (!contents.toLowerCase().includes("superseded") || !contents.includes(target)) {
    failures.push(`${name} must remain a superseded compatibility pointer to ${target}.`);
  }
  if (contents.split(/\r?\n/).length > 30) {
    failures.push(`${name} has grown beyond a pointer document.`);
  }
}

for (const path of [
  "../src/lib/slack.ts",
  "../src/lib/rill.ts",
  "../src/lib/rillAllowlist.ts",
  "../app/channels/page.tsx",
  "../.github/workflows/rill-schema-check.yml",
]) {
  if (existsSync(new URL(path, import.meta.url))) {
    failures.push(`${path.replace("../", "")} is a retired active integration surface.`);
  }
}

for (const variable of ["SLACK_BOT_TOKEN", "RILL_API_TOKEN", "RILL_API_BASE_URL"]) {
  if (exampleEnvironment.includes(variable)) {
    failures.push(`.env.example must not advertise retired variable ${variable}.`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`source-of-truth: ${failure}`);
  process.exit(1);
}

console.log(`source-of-truth: OK (${versionMatch?.[1].trim() ?? "unknown"})`);
