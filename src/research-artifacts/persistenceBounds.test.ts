import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertResearchArtifactBounds,
  MAX_RESEARCH_ARTIFACT_EVIDENCE_REFERENCES,
  MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES,
  researchArtifactPayloadBytes,
} from "./persistenceBounds.ts";

test("research-artifact evidence references accept the exact limit and reject one over", () => {
  const exact = Array.from({ length: MAX_RESEARCH_ARTIFACT_EVIDENCE_REFERENCES }, (_, index) => index + 1);
  assert.doesNotThrow(() => assertResearchArtifactBounds({}, exact));
  assert.throws(
    () => assertResearchArtifactBounds({}, [...exact, exact.length + 1]),
    /research-artifact-evidence-limit-exceeded/,
  );
});

test("research-artifact payload accepts the exact UTF-8 byte limit and rejects one byte over", () => {
  const shellBytes = researchArtifactPayloadBytes({ value: "" });
  const exact = { value: "a".repeat(MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES - shellBytes) };

  assert.equal(researchArtifactPayloadBytes(exact), MAX_RESEARCH_ARTIFACT_PAYLOAD_BYTES);
  assert.doesNotThrow(() => assertResearchArtifactBounds(exact, []));
  assert.throws(
    () => assertResearchArtifactBounds({ value: `${exact.value}a` }, []),
    /research-artifact-payload-too-large/,
  );
});

test("research-artifact payload size counts UTF-8 bytes and rejects unserializable values", () => {
  assert.equal(researchArtifactPayloadBytes({ value: "ø" }) - researchArtifactPayloadBytes({ value: "a" }), 1);
  assert.throws(() => researchArtifactPayloadBytes(undefined), /research-artifact-payload-invalid/);
  assert.throws(() => researchArtifactPayloadBytes({ value: BigInt(1) }), /research-artifact-payload-invalid/);
});

test("every research-artifact insert uses the central bounded value constructor", () => {
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
  for (const path of visit(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    const inserts = source.match(/\.insert\(researchArtifact\)\.values\(/g)?.length ?? 0;
    const bounded = source.match(/\.insert\(researchArtifact\)\.values\(\s*boundedResearchArtifactValues\(/g)?.length ?? 0;
    assert.equal(bounded, inserts, `${relative(sourceRoot, path)} bypasses boundedResearchArtifactValues`);
  }
});
