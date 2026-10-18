import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import {
  canonicalEvidence,
  canonicalRetentionWork,
  citation,
  client,
  evidenceCollection,
  intelligenceRecord,
  qualitativeTheme,
  quantitativeObservation,
  researchArtifact,
} from "../src/db/schema";

type Fixture = {
  tenant: typeof client.$inferSelect;
  input: Parameters<typeof import("../src/db/queries/canonical_evidence").persistAcquisition>[0];
};

function errorChainIncludes(error: unknown, expected: string) {
  let current = error;
  while (current instanceof Error) {
    if (current.message.includes(expected)) return true;
    current = current.cause;
  }
  return false;
}

export async function runBoundedRetentionCases(
  t: TestContext,
  db: typeof import("../src/db/client").db,
  probe: Pool,
  fixture: (existingTenant?: typeof client.$inferSelect) => Promise<Fixture>,
) {
  const { persistAcquisition } = await import("../src/db/queries/canonical_evidence");
  const { enforceCanonicalRetention } = await import("../src/db/queries/retention");

  async function expiredEvidence(existingTenant?: typeof client.$inferSelect) {
    const f = await fixture(existingTenant);
    const persisted = await persistAcquisition(f.input);
    const id = persisted.evidenceIds[0];
    assert.ok(id);
    assert.ok(persisted.collectionId);
    await db.update(canonicalEvidence).set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(canonicalEvidence.id, id));
    return { f, id, collectionId: persisted.collectionId };
  }

  await t.test("retention transactions apply the database-enforced timeout contract", async () => {
    const { f } = await expiredEvidence();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const tableName = `retention_timeout_probe_${suffix}`;
    const functionName = `retention_timeout_fn_${suffix}`;
    const triggerName = `retention_timeout_trigger_${suffix}`;
    if (![tableName, functionName, triggerName].every((value) => /^[a-z0-9_]+$/.test(value))) {
      throw new Error("unsafe-retention-timeout-probe-identifier");
    }
    try {
      await probe.query(`create table public.${tableName} (statement_timeout text not null, lock_timeout text not null)`);
      await probe.query(`
        create function public.${functionName}() returns trigger language plpgsql as $$
        begin
          insert into public.${tableName} (statement_timeout, lock_timeout)
          values (current_setting('statement_timeout'), current_setting('lock_timeout'));
          return new;
        end $$
      `);
      await probe.query(`create trigger ${triggerName} before insert on public.canonical_retention_work for each row execute function public.${functionName}()`);
      await enforceCanonicalRetention(new Date(), f.tenant.id);
      const settings = await probe.query<{ statement_timeout: string; lock_timeout: string }>(
        `select statement_timeout, lock_timeout from public.${tableName}`,
      );
      assert.ok(settings.rows.length > 0);
      assert.ok(settings.rows.every((row) => row.statement_timeout === "10s" && row.lock_timeout === "1s"));
    } finally {
      await probe.query(`drop trigger if exists ${triggerName} on public.canonical_retention_work`);
      await probe.query(`drop function if exists public.${functionName}()`);
      await probe.query(`drop table if exists public.${tableName}`);
    }
  });

  await t.test("collection and intelligence lifecycle changes roll back when their audit cannot commit", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const functionName = `retention_audit_guard_${suffix}`;
    const triggerName = `retention_audit_guard_trigger_${suffix}`;
    if (![functionName, triggerName].every((value) => /^[a-z0-9_]+$/.test(value))) {
      throw new Error("unsafe-retention-audit-probe-identifier");
    }
    try {
      await probe.query(`
        create function public.${functionName}() returns trigger language plpgsql as $$
        begin
          if new.entity_type = 'canonical_retention_batch' then
            raise exception 'synthetic retention audit failure';
          end if;
          return new;
        end $$
      `);
      await probe.query(`create trigger ${triggerName} before insert on public.governance_audit for each row execute function public.${functionName}()`);

      const collectionCase = await expiredEvidence();
      await db.update(evidenceCollection).set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(evidenceCollection.id, collectionCase.collectionId));
      await assert.rejects(
        enforceCanonicalRetention(new Date(), collectionCase.f.tenant.id),
        (error) => errorChainIncludes(error, "synthetic retention audit failure"),
      );
      const [collectionAfter] = await db.select().from(evidenceCollection)
        .where(eq(evidenceCollection.id, collectionCase.collectionId));
      assert.notEqual(collectionAfter.lifecycle, "expired");

      const intelligenceFixture = await fixture();
      const [record] = await db.insert(intelligenceRecord).values({
        clientId: intelligenceFixture.tenant.id,
        kind: "fact",
        title: "Synthetic retention rollback",
        statement: "Must remain live when audit persistence fails.",
        lifecycle: "live",
        reviewState: "accepted",
        evidenceIds: [],
        contradictionIds: [],
        dependencyIds: [],
        applicabilityJson: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] },
        confidence: 0.8,
        uncertainty: ["Synthetic only"],
        synthesisBy: "human",
        decayAt: new Date(Date.now() - 1_000),
      }).returning();
      await assert.rejects(
        enforceCanonicalRetention(new Date(), intelligenceFixture.tenant.id),
        (error) => errorChainIncludes(error, "synthetic retention audit failure"),
      );
      const [recordAfter] = await db.select().from(intelligenceRecord).where(eq(intelligenceRecord.id, record.id));
      assert.equal(recordAfter.lifecycle, "live");
    } finally {
      await probe.query(`drop trigger if exists ${triggerName} on public.governance_audit`);
      await probe.query(`drop function if exists public.${functionName}()`);
    }
  });

  await t.test("bounded phases drain oversized dependants before the final tombstone", async () => {
    const { f, id } = await expiredEvidence();
    await db.insert(quantitativeObservation).values(Array.from({ length: 105 }, (_, index) => ({
      clientId: f.tenant.id,
      evidenceId: id,
      metricKey: `bounded-${index}`,
      value: index,
      unit: "count",
      observedAt: new Date(),
      dimensionsJson: {},
    })));
    await db.insert(qualitativeTheme).values(Array.from({ length: 105 }, (_, index) => ({
      clientId: f.tenant.id,
      label: `bounded-${index}`,
      paraphrase: "Synthetic integration content.",
      evidenceIds: [id],
      occurrenceCount: 1,
      sourceDiversity: 1,
      method: "synthetic",
    })));
    await db.insert(citation).values(Array.from({ length: 105 }, (_, index) => ({
      clientId: f.tenant.id,
      evidenceId: id,
      level: "paraphrased" as const,
      safeReference: `bounded-reference-${index}`,
      excerpt: "Synthetic copied wording.",
    })));
    await db.insert(researchArtifact).values(Array.from({ length: 11 }, (_, index) => ({
      clientId: f.tenant.id,
      artifactKey: `bounded-retention-${randomUUID()}`,
      artifactType: "decision-brief@2",
      status: "draft",
      version: 1,
      payloadJson: { citations: [{ evidenceId: String(id), safeReference: `copy-${index}`, excerpt: "Copied wording." }] },
      evidenceIds: [id],
    })));

    const retained = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(retained.observationsRemoved, 105);
    assert.equal(retained.themesRemoved, 105);
    assert.equal(retained.artifactCitationsRedacted, 11);
    assert.equal(retained.evidenceExpired, 1);
    assert.equal((await db.select().from(canonicalRetentionWork).where(eq(canonicalRetentionWork.evidenceId, id))).length, 0);
    const [evidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, id));
    assert.equal(evidence.lifecycle, "expired");
    assert.equal(evidence.sourceContent, "[expired: retained evidence content removed]");
    assert.equal((await db.select().from(quantitativeObservation).where(eq(quantitativeObservation.evidenceId, id))).length, 0);
    assert.equal((await db.select().from(qualitativeTheme).where(and(
      eq(qualitativeTheme.clientId, f.tenant.id),
    ))).some((row) => row.evidenceIds.includes(id)), false);
    const redacted = await db.select().from(citation).where(eq(citation.evidenceId, id));
    assert.equal(redacted.length, 105);
    assert.ok(redacted.every((row) => row.safeReference === "[expired evidence]" && row.excerpt === null));
  });

  await t.test("evidence discovery drains one-over-limit backlog through durable repeated runs", async () => {
    const f = await fixture();
    const persisted = await persistAcquisition(f.input);
    const [seed] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, persisted.evidenceIds[0]));
    assert.ok(seed);
    const expiresAt = new Date(Date.now() - 1_000);
    const inserted = await db.insert(canonicalEvidence).values(Array.from({ length: 100 }, (_, index) => ({
      clientId: seed.clientId,
      collectionId: seed.collectionId,
      sourceConnectionId: seed.sourceConnectionId,
      externalReference: `bounded-discovery-${randomUUID()}`,
      safeSourceUrl: seed.safeSourceUrl,
      sourceContent: seed.sourceContent,
      synthesis: seed.synthesis,
      contentHash: `bounded-discovery-${randomUUID()}`,
      citationLevel: seed.citationLevel,
      lifecycle: seed.lifecycle,
      grade: seed.grade,
      confidence: seed.confidence,
      sensitive: seed.sensitive,
      identityRisk: seed.identityRisk,
      redactions: seed.redactions,
      methodJson: seed.methodJson,
      rightsJson: seed.rightsJson,
      applicabilityJson: seed.applicabilityJson,
      publishedAt: seed.publishedAt,
      observedAt: seed.observedAt,
      ingestedAt: new Date(seed.ingestedAt.getTime() + index),
      expiresAt,
    }))).returning({ id: canonicalEvidence.id });
    const evidenceIds = [seed.id, ...inserted.map((row) => row.id)];
    await db.update(canonicalEvidence).set({ expiresAt }).where(eq(canonicalEvidence.id, seed.id));

    let result = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(result.progress?.evidenceDiscovery.processed, 100);
    assert.equal(result.progress?.evidenceDiscovery.batchFull, true);
    let invocations = 1;
    while (result.batchFull && invocations < 40) {
      result = await enforceCanonicalRetention(new Date(), f.tenant.id);
      invocations += 1;
    }
    assert.ok(invocations > 1 && invocations < 40);
    assert.equal(result.batchFull, false);
    const drained = await db.select({ lifecycle: canonicalEvidence.lifecycle }).from(canonicalEvidence)
      .where(and(eq(canonicalEvidence.clientId, f.tenant.id), eq(canonicalEvidence.sourceConnectionId, seed.sourceConnectionId)));
    assert.equal(drained.length, evidenceIds.length);
    assert.ok(drained.every((row) => row.lifecycle === "expired"));
    assert.equal((await db.select().from(canonicalRetentionWork).where(inArray(canonicalRetentionWork.evidenceId, evidenceIds))).length, 0);
  });

  await t.test("collection and intelligence batches distinguish exact limit from one over and resume", async () => {
    const f = await fixture();
    const persisted = await persistAcquisition(f.input);
    const expiresAt = new Date(Date.now() - 1_000);
    await db.insert(evidenceCollection).values(Array.from({ length: 251 }, (_, index) => ({
      clientId: f.tenant.id,
      sourceConnectionId: f.input.sourceConnectionId,
      acquisitionJobId: persisted.jobId,
      title: `bounded-collection-${index}`,
      methodJson: f.input.method,
      rightsJson: f.input.rights,
      applicabilityJson: f.input.applicability,
      lifecycle: "live" as const,
      expiresAt,
    })));
    await db.insert(intelligenceRecord).values(Array.from({ length: 251 }, (_, index) => ({
      clientId: f.tenant.id,
      kind: "fact" as const,
      title: `bounded-intelligence-${index}`,
      statement: "Synthetic bounded retention record.",
      lifecycle: "live" as const,
      reviewState: "accepted" as const,
      evidenceIds: [],
      contradictionIds: [],
      dependencyIds: [],
      applicabilityJson: f.input.applicability,
      confidence: 0.8,
      uncertainty: ["Synthetic only"],
      synthesisBy: "human",
      decayAt: expiresAt,
    })));

    const first = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(first.collectionsExpired, 250);
    assert.equal(first.intelligenceDecayed, 250);
    assert.equal(first.progress?.collections.batchFull, true);
    assert.equal(first.progress?.intelligence.batchFull, true);
    const second = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(second.collectionsExpired, 1);
    assert.equal(second.intelligenceDecayed, 1);
    assert.equal(second.progress?.collections.batchFull, false);
    assert.equal(second.progress?.intelligence.batchFull, false);
  });

  await t.test("a rolled-back artifact chunk leaves its cursor resumable", async () => {
    const { f, id } = await expiredEvidence();
    const [artifact] = await db.insert(researchArtifact).values({
      clientId: f.tenant.id,
      artifactKey: `crash-resume-${randomUUID()}`,
      artifactType: "decision-brief@2",
      status: "draft",
      version: 1,
      payloadJson: { citations: [{ evidenceId: String(id), safeReference: "copy", excerpt: "Copied wording." }] },
      evidenceIds: [id],
    }).returning({ id: researchArtifact.id });
    await db.insert(canonicalRetentionWork).values({ evidenceId: id, phase: "artifacts" });

    const blocker = await probe.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select id from research_artifact where id = $1 for update", [artifact.id]);
      await assert.rejects(enforceCanonicalRetention(new Date(), f.tenant.id), (error: unknown) => {
        return error instanceof Error && error.message === "maintenance-stage-deadline-exceeded";
      });
      const [work] = await db.select().from(canonicalRetentionWork).where(eq(canonicalRetentionWork.evidenceId, id));
      assert.equal(work.phase, "artifacts");
      assert.equal(work.cursorId, 0);
      const [evidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, id));
      assert.notEqual(evidence.lifecycle, "expired");
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
    const resumed = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(resumed.evidenceExpired, 1);
    assert.equal(resumed.artifactCitationsRedacted, 1);
    assert.equal((await db.select().from(canonicalRetentionWork).where(eq(canonicalRetentionWork.evidenceId, id))).length, 0);
  });

  await t.test("locked due evidence is reported as continuation and handled after release", async () => {
    const { f, id } = await expiredEvidence();
    const blocker = await probe.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select id from canonical_evidence where id = $1 for update", [id]);
      const deferred = await enforceCanonicalRetention(new Date(), f.tenant.id);
      assert.equal(deferred.evidenceExpired, 0);
      assert.equal(deferred.batchFull, true);
      assert.equal(deferred.progress?.evidenceDiscovery.batchFull, true);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
    const resumed = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(resumed.evidenceExpired, 1);
  });

  await t.test("concurrent workers share durable work without crossing tenant scope", async () => {
    const first = await expiredEvidence();
    const second = await expiredEvidence(first.f.tenant);
    const untouched = await expiredEvidence();
    await Promise.all([
      enforceCanonicalRetention(new Date(), first.f.tenant.id),
      enforceCanonicalRetention(new Date(), second.f.tenant.id),
    ]);
    const [firstRow] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, first.id));
    const [secondRow] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, second.id));
    const [untouchedRow] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, untouched.id));
    assert.equal(firstRow.lifecycle, "expired");
    assert.equal(secondRow.lifecycle, "expired");
    assert.notEqual(untouchedRow.lifecycle, "expired");
  });

  await t.test("a pre-existing oversized artifact is quarantined without starving finalization", async () => {
    const { f, id } = await expiredEvidence();
    const [artifact] = await db.insert(researchArtifact).values({
      clientId: f.tenant.id,
      artifactKey: `oversize-reference-set-${randomUUID()}`,
      artifactType: "decision-brief@2",
      status: "draft",
      version: 1,
      payloadJson: { citations: [{ evidenceId: String(id), safeReference: "copy", excerpt: "Copied wording." }] },
      evidenceIds: [id, ...Array.from({ length: 100 }, (_, index) => -(index + 1))],
    }).returning();
    const result = await enforceCanonicalRetention(new Date(), f.tenant.id);
    assert.equal(result.evidenceExpired, 1);
    assert.equal(result.artifactCitationsRedacted, 1);
    const [evidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, id));
    assert.equal(evidence.lifecycle, "expired");
    const [quarantined] = await db.select().from(researchArtifact).where(eq(researchArtifact.id, artifact.id));
    assert.equal(quarantined.status, "needs_context");
    assert.deepEqual(quarantined.payloadJson, {
      kind: "retention-redacted-artifact@1",
      reason: "Supporting evidence is no longer usable under current source policy.",
      evidenceId: String(id),
    });
    assert.equal(quarantined.evidenceIds.length, 101, "lineage columns remain intact");
    assert.equal((await db.select().from(canonicalRetentionWork).where(eq(canonicalRetentionWork.evidenceId, id))).length, 0);
  });

  await t.test("malformed cross-tenant dependants are never read, changed or used to block finalization", async () => {
    const owned = await expiredEvidence();
    const other = await fixture();
    const [foreignObservation] = await db.insert(quantitativeObservation).values({
      clientId: other.tenant.id,
      evidenceId: owned.id,
      metricKey: "poisoned-cross-tenant-reference",
      value: 1,
      unit: "count",
      observedAt: new Date(),
      dimensionsJson: {},
    }).returning();
    const [foreignTheme] = await db.insert(qualitativeTheme).values({
      clientId: other.tenant.id,
      label: "poisoned-cross-tenant-reference",
      paraphrase: "Must remain untouched.",
      evidenceIds: [owned.id],
      occurrenceCount: 1,
      sourceDiversity: 1,
      method: "synthetic",
    }).returning();
    const [foreignCitation] = await db.insert(citation).values({
      clientId: other.tenant.id,
      evidenceId: owned.id,
      level: "paraphrased",
      safeReference: "foreign-safe-reference",
      excerpt: "Must remain untouched.",
    }).returning();
    const [foreignArtifact] = await db.insert(researchArtifact).values({
      clientId: other.tenant.id,
      artifactKey: `poisoned-cross-tenant-${randomUUID()}`,
      artifactType: "decision_brief",
      status: "draft",
      version: 1,
      payloadJson: { citations: [{ evidenceId: String(owned.id), safeReference: "foreign", excerpt: "Must remain untouched." }] },
      evidenceIds: [owned.id],
    }).returning();

    const result = await enforceCanonicalRetention(new Date(), owned.f.tenant.id);
    assert.equal(result.evidenceExpired, 1);
    assert.equal((await db.select().from(quantitativeObservation).where(eq(quantitativeObservation.id, foreignObservation.id))).length, 1);
    assert.equal((await db.select().from(qualitativeTheme).where(eq(qualitativeTheme.id, foreignTheme.id))).length, 1);
    const [citationAfter] = await db.select().from(citation).where(eq(citation.id, foreignCitation.id));
    assert.equal(citationAfter.safeReference, "foreign-safe-reference");
    assert.equal(citationAfter.excerpt, "Must remain untouched.");
    const [artifactAfter] = await db.select().from(researchArtifact).where(eq(researchArtifact.id, foreignArtifact.id));
    assert.deepEqual(artifactAfter.payloadJson, foreignArtifact.payloadJson);
  });
}
