import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  checksummedArtifact,
  classifyAbilityRelation,
  classifyLegacySchemaPresence,
  classifyMigrations,
  classifyQueueClientScope,
  deriveDiscoveryResult,
  inventoryExitCode,
  projectAbilityManifest,
  resolveValidatedClientScope,
  verifyArtifactIntegrity,
  writeExclusive,
} from "./legacy-inventory.ts";

test("canonical inventory checksums are key-order independent and cover payload changes", () => {
  const first = { b: [2, { z: true, a: null }], a: "value" };
  const second = { a: "value", b: [2, { a: null, z: true }] };
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(checksummedArtifact(first).checksum.digest, checksummedArtifact(second).checksum.digest);
  assert.notEqual(checksummedArtifact(first).checksum.digest, checksummedArtifact({ ...first, a: "changed" }).checksum.digest);
  assert.equal(canonicalJson(checksummedArtifact(first)).includes("recursive-key-sort-json-utf8-v1"), true);
});
test("artifact checksum verifies integrity without claiming source authentication", () => {
  const artifact = checksummedArtifact({ kind: "legacy-inventory", nested: { count: 2 } });
  assert.equal(verifyArtifactIntegrity(artifact), true);
  assert.equal(verifyArtifactIntegrity({ ...artifact, nested: { count: 3 } }), false);
  assert.equal(verifyArtifactIntegrity({ ...artifact, checksum: { ...artifact.checksum, digest: "invalid" } }), false);
});
test("migration state distinguishes exact, prefix, ahead, divergent and missing histories", () => {
  const expected = [
    { tag: "0001_one", createdAt: 1, hash: "a" },
    { tag: "0002_two", createdAt: 2, hash: "b" },
  ];
  assert.equal(classifyMigrations(expected, expected).state, "exact");
  assert.equal(classifyMigrations(expected, expected.slice(0, 1)).state, "prefix");
  assert.equal(classifyMigrations(expected, [...expected, { createdAt: 3, hash: "c" }]).state, "ahead");
  assert.equal(classifyMigrations(expected, [{ createdAt: 1, hash: "changed" }]).state, "diverged");
  const divergentWithKnownLast = classifyMigrations(expected, [{ createdAt: 1, hash: "changed" }, expected[1]]);
  assert.equal(divergentWithKnownLast.state, "diverged");
  assert.equal(divergentWithKnownLast.appliedHeadTag, null);
  assert.equal(classifyMigrations(expected, []).state, "missing");
  assert.equal(classifyMigrations(expected, expected).appliedHeadTag, "0002_two");
});

test("stored ability manifests are related only by exact id and version", () => {
  const catalog = [
    { id: "competitor-positioning-research", version: "1.0.0", scope: "v1", state: "implemented" },
    { id: "competitor-intelligence", version: "1.0.0", scope: "deferred", state: "implemented" },
  ];
  assert.equal(classifyAbilityRelation("competitor-positioning-research", "1.0.0", catalog), "governed_v1_target");
  assert.equal(classifyAbilityRelation("competitor-intelligence", "1.0.0", catalog), "governed_deferred");
  assert.equal(classifyAbilityRelation("competitor-intelligence", "2.0.0", catalog), "unknown_closed");
});

test("missing required legacy relations fail discovery while the optional manifest does not", () => {
  const base = ["client", "market", "brand", "brand_market", "research_instruction", "channel", "insight_route", "research_run", "evidence", "insight", "insight_evidence", "audit_log"];
  const withoutOptional = classifyLegacySchemaPresence(base);
  assert.equal(withoutOptional.discoveryState, "complete");
  assert.deepEqual(withoutOptional.missingOptional, ["ability_manifest"]);
  const partial = classifyLegacySchemaPresence(base.filter((name) => name !== "evidence"));
  assert.equal(partial.discoveryState, "failed");
  assert.deepEqual(partial.missingRequired, ["evidence"]);
});

test("queue payload tenancy rejects absent, malformed and foreign client identifiers", () => {
  assert.equal(classifyQueueClientScope(7, 7), "tenant");
  assert.equal(classifyQueueClientScope("7", 7), "tenant");
  assert.equal(classifyQueueClientScope("8", 7), "foreign");
  for (const value of [undefined, null, "", "07", "x", 7.5, 0]) assert.equal(classifyQueueClientScope(value, 7), "malformed");
});

test("partial queue schemas fail discovery and blocker artifacts require a non-zero CLI exit", () => {
  const complete = deriveDiscoveryResult({
    missingRequiredRelations: [],
    clientRelationPresent: true,
    clientScopeValidated: true,
    queueSchemaState: "complete",
  });
  assert.deepEqual(complete, { discoveryState: "complete", discoveryFailures: [] });
  assert.equal(inventoryExitCode(complete.discoveryState), 0);

  const partial = deriveDiscoveryResult({
    missingRequiredRelations: [],
    clientRelationPresent: true,
    clientScopeValidated: true,
    queueSchemaState: "partial",
  });
  assert.deepEqual(partial, { discoveryState: "failed", discoveryFailures: ["partial_pgboss_schema"] });
  assert.equal(inventoryExitCode(partial.discoveryState), 2);
  assert.equal(inventoryExitCode("failed"), 2);
});

test("deployment scope mismatches close tenant inspection without exposing an unvalidated client", () => {
  const environment = {
    DATABASE_URL: "postgres://not-used-by-this-pure-test",
    MARKET_RESEARCH_CLIENT_ID: "7",
    MARKET_RESEARCH_CLIENT_SLUG: "expected-client",
  };
  assert.deepEqual(resolveValidatedClientScope(environment, [{ id: 7, slug: "expected-client" }]), { id: 7, slug: "expected-client" });
  assert.equal(resolveValidatedClientScope(environment, [{ id: 7, slug: "different-client" }]), null);
  assert.equal(resolveValidatedClientScope(environment, [{ id: 7, slug: "expected-client" }, { id: 8, slug: "other-client" }]), null);
});

test("aggregate artifacts do not acquire source-row canaries through checksum generation", () => {
  const canary = "PERSONAL-DATA-CANARY-93e2";
  const projected = projectAbilityManifest({
    client_id: 7,
    ability_key: "known",
    version: "1.0.0",
    status: "active",
    manifest_json: { nested: { secret: canary } },
  }, 7, [{ id: "known", version: "1.0.0", scope: "deferred", state: "implemented" }]);
  const artifact = checksummedArtifact({
    schemaVersion: 1,
    installation: { clientId: 7, clientScopeValidated: true },
    legacy: { fieldPresence: { "evidence.author_handle": 1 }, abilityManifests: [projected] },
    queue: { pendingCount: 1 },
  });
  const serialized = canonicalJson(artifact);
  assert.equal(serialized.includes(canary), false);
  assert.equal(serialized.includes('"status":"active"'), false);
  for (const forbidden of ["databaseUrl", "clientName", "clientSlug", "manifestJson", "jobData", "authorHandle", "textSnippet", "beforeJson", "afterJson"])
    assert.equal(serialized.includes(`\"${forbidden}\"`), false);
});

test("unknown manifest metadata is digest-only and closed", () => {
  const projected = projectAbilityManifest({
    client_id: 7,
    ability_key: "UNTRUSTED-ABILITY-CANARY",
    version: "UNTRUSTED-VERSION-CANARY",
    status: "UNTRUSTED-STATUS-CANARY",
    manifest_json: { safe: true },
  }, 7, []);
  const serialized = canonicalJson(projected);
  assert.equal(projected.catalogRelation, "unknown_closed");
  assert.equal(projected.activationStatus, "closed");
  assert.equal(projected.governedCatalog, null);
  for (const canary of ["UNTRUSTED-ABILITY-CANARY", "UNTRUSTED-VERSION-CANARY", "UNTRUSTED-STATUS-CANARY"])
    assert.equal(serialized.includes(canary), false);
});

test("artifact writing is owner-only and refuses overwrite or symlink targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "legacy-inventory-test-"));
  const artifact = join(directory, "inventory.json");
  const target = join(directory, "target.json");
  const link = join(directory, "link.json");
  try {
    await writeExclusive(artifact, "safe\n");
    assert.equal(await readFile(artifact, "utf8"), "safe\n");
    assert.equal((await stat(artifact)).mode & 0o777, 0o600);
    await assert.rejects(writeExclusive(artifact, "overwrite\n"));
    await writeExclusive(target, "target\n");
    await symlink(target, link);
    await assert.rejects(writeExclusive(link, "through-link\n"));
    assert.equal(await readFile(target, "utf8"), "target\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
