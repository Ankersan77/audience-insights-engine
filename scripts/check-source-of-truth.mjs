#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const blueprint = readFileSync(new URL("../BLUEPRINT.md", import.meta.url), "utf8");
const roadmap = readFileSync(new URL("../ROADMAP.md", import.meta.url), "utf8");
const productSpec = readFileSync(new URL("../product-spec.md", import.meta.url), "utf8");
const implementationPlan = readFileSync(new URL("../implementation-plan.md", import.meta.url), "utf8");
const exampleEnvironment = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const agentRules = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const compatibilityManifest = readFileSync(new URL("../compatibility-manifest.json", import.meta.url), "utf8");
const capabilityRegister = readFileSync(new URL("../product-capabilities.json", import.meta.url), "utf8");

const failures = [];
const versionMatch = blueprint.match(/^\| Blueprint version \|\s*([^|\n]+)\s*\|$/m);
if (!versionMatch) failures.push("BLUEPRINT.md must declare a Blueprint version table row.");
if (versionMatch && !roadmap.includes(`BLUEPRINT.md\` version ${versionMatch[1].trim()}`)) {
  failures.push("ROADMAP.md must reference the exact canonical blueprint version.");
}

for (const [label, contents, phrases] of [
  ["BLUEPRINT.md", blueprint, ["AI-native", "remote Model Context Protocol (MCP)", "competitor-positioning-research", "Managed single-tenant"]],
  ["ROADMAP.md", roadmap, ["R1A1 — Inventory and neutral worker extraction", "R1B — Forward schema cleanup", "MCP foundation", "Second-host portability proof"]],
  ["README.md", readme, ["AI-native", "remote MCP", "Transition status"]],
]) {
  for (const phrase of phrases) {
    if (!contents.includes(phrase)) failures.push(`${label} must preserve canonical product phrase: ${phrase}`);
  }
}

if (agentRules.includes("Preserve the pinned `vendor/last30days` submodule")) {
  failures.push("AGENTS.md must not require preservation of the retired last30days dependency.");
}

for (const [label, contents] of [
  ["compatibility-manifest.json", compatibilityManifest],
  ["product-capabilities.json", capabilityRegister],
]) {
  if (!contents.includes(`\"blueprintVersion\": \"${versionMatch?.[1].trim()}\"`)
    && !contents.includes(`\"version\": \"${versionMatch?.[1].trim()}\"`)) {
    failures.push(`${label} must reference the canonical Blueprint version.`);
  }
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
