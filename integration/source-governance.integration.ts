import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { appUser, client, canonicalEvidence, researchProject, intelligenceRecord, sourceConnection, sourceAcquisitionJob, sourceAcquisitionReceipt } from "../src/db/schema";
import { PublicWebEvidenceAdapter } from "../src/evidence/adapters";
import type { SourceConnectionPolicy } from "../src/core/contracts";

// Refuse accidental execution against the application's database. No tables are
// truncated: each test creates uniquely named, synthetic tenant/source fixtures.
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test");
process.env.DATABASE_URL = url;
if (process.env.NODE_ENV === "production") throw new Error("Integration tests must not run in production mode");

const { db } = await import("../src/db/client");
const { createSourceConnection, listSourceConnections, revokeSourceConnection } = await import("../src/db/queries/sources");
const { persistAcquisition, completeExistingAcquisition, failExistingAcquisition } = await import("../src/db/queries/canonical_evidence");
const { claimAcquisitionJob, cancelAcquisitionJob } = await import("../src/db/queries/acquisition_execution");
const { loadResearchContextSources } = await import("../src/db/queries/research_context");
const { createActiveSolutionProfile } = await import("../src/db/queries/solution_profiles");
const { saveDecisionBrief } = await import("../src/db/queries/workspace_intelligence");
const { runContextualResearch } = await import("../src/abilities/synthesis");
const probe = new Pool({ connectionString: url });
const rights = { basis: "public_permitted" as const, commercialUse: true, quotationAllowed: false, restrictions: [] };
const policy: SourceConnectionPolicy = {
  permissions: ["read:reports"], dataClassifications: ["public"], permittedPurposes: ["market-research"],
  markets: ["DK"], languages: ["da"], cadence: "manual", lookbackDays: 30, quota: 5, costLimit: 0,
};

async function fixture(existingTenant?: typeof client.$inferSelect) {
  const key = randomUUID();
  const tenant = existingTenant ?? (await db.insert(client).values({ name: "Synthetic integration tenant", slug: `integration-${key}` }).returning())[0];
  const source = await createSourceConnection({ clientId: tenant.id, connectorId: `source-${key}`, connectorVersion: "1.0.0",
    sourceClass: "official_or_public", rights, policy, retentionDays: 30, rawRetentionHours: 0, credentialRef: "secret-store/test/reference",
  });
  const now = new Date().toISOString();
  const applicability = { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] };
  const method = { method: "synthetic integration fixture", limitations: ["Not real research."] };
  const job = { id: key, clientId: String(tenant.id), sourceId: String(source.id), adapterId: source.connectorId,
    dataClassification: "public" as const, request: { operation: "manual-document", filters: { markets: ["DK"], languages: ["da"] } }, idempotencyKey: key, requestedAt: now,
  };
  const result = await new PublicWebEvidenceAdapter([{ id: key, url: "https://example.org/research", permitted: true,
    content: "Synthetic aggregate category trend for an integration test.", rights, method, applicability,
  }]).run(job, { now, async resolveCredential() { throw new Error("unused"); } }, { minimumCohortSize: 10, retainedEvidenceDays: 30, allowVerbatim: false, sensitiveTerms: [] });
  result.receipt.estimatedCost = 0;
  return { tenant, source, input: { clientId: tenant.id, sourceConnectionId: source.id, operation: job.request.operation, request: job.request,
    idempotencyKey: key, title: "Synthetic source", rights, method, applicability, collectionExpiresAt: result.evidence[0].expiresAt, result,
  } };
}

async function queued(f: Awaited<ReturnType<typeof fixture>>) {
  const [job] = await db.insert(sourceAcquisitionJob).values({ clientId: f.tenant.id, sourceConnectionId: f.source.id,
    operation: f.input.operation, requestJson: f.input.request, idempotencyKey: randomUUID(),
  }).returning();
  assert.equal((await claimAcquisitionJob(job.id)).kind, "claimed");
  return job;
}

async function waitForBlocked(count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await probe.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0");
    if (result.rows[0].n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} blocked database operations`);
}

test("PostgreSQL source governance, migrations and concurrent transitions", async (t) => {
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    await t.test("manual retention enforces tenant, purpose, output scope and revocation", async () => {
      const f = await fixture();
      const other = await fixture();
      await assert.rejects(persistAcquisition({ ...f.input, clientId: other.tenant.id, result: { ...f.input.result, evidence: [] } }), /source-connection-not-found/);
      const [visible] = await listSourceConnections(f.tenant.id);
      assert.equal(visible.hasCredentialReference, true);
      assert.equal("credentialRef" in visible, false);
      assert.equal("configuration" in visible, false);
      await db.update(sourceConnection).set({ configurationJson: { ...policy, permittedPurposes: ["unrelated-purpose"] } }).where(eq(sourceConnection.id, f.source.id));
      await assert.rejects(persistAcquisition(f.input), /source-purpose-outside-policy/);
      await db.update(sourceConnection).set({ configurationJson: policy }).where(eq(sourceConnection.id, f.source.id));
      const wrongScope = structuredClone(f.input);
      wrongScope.result.evidence[0].applicability.markets = ["SE"];
      await assert.rejects(persistAcquisition(wrongScope), /source-markets-outside-policy/);
      assert.equal((await persistAcquisition(f.input)).evidenceIds.length, 1);
      assert.equal((await persistAcquisition(f.input)).replayed, true);
      await revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date() });
      await assert.rejects(persistAcquisition({ ...f.input, idempotencyKey: randomUUID() }), /source-unavailable/);
      const [source] = await db.select().from(sourceConnection).where(eq(sourceConnection.id, f.source.id));
      assert.equal(source.health, "unavailable");
    });

    await t.test("revocation winning the source lock rejects a concurrent worker completion", async () => {
      const f = await fixture();
      const job = await queued(f);
      const barrier = await probe.connect();
      try {
        await barrier.query("begin");
        await barrier.query("select id from source_connection where id = $1 for update", [f.source.id]);
        const revoked = revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date() });
        await waitForBlocked(1);
        const completion = completeExistingAcquisition({ ...f.input, jobId: job.id });
        const rejected = assert.rejects(completion, /running-acquisition-job-not-found|source-unavailable/);
        await waitForBlocked(2);
        await barrier.query("commit");
        await revoked;
        await rejected;
        assert.equal((await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.sourceConnectionId, f.source.id))).length, 0);
        const [receipt] = await db.select().from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, job.id));
        assert.equal(receipt.status, "cancelled");
      } finally { await barrier.query("rollback"); barrier.release(); }
    });

    await t.test("completion winning the lock is expired by the following revocation", async () => {
      const f = await fixture();
      const job = await queued(f);
      const barrier = await probe.connect();
      try {
        await barrier.query("begin");
        await barrier.query("select id from source_connection where id = $1 for update", [f.source.id]);
        const completion = completeExistingAcquisition({ ...f.input, jobId: job.id });
        await waitForBlocked(1);
        const revoked = revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date() });
        await waitForBlocked(2);
        await barrier.query("commit");
        await completion;
        await revoked;
        const [source] = await db.select().from(sourceConnection).where(eq(sourceConnection.id, f.source.id));
        assert.equal(source.health, "unavailable");
        const evidence = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.sourceConnectionId, f.source.id));
        assert.equal(evidence.length, 1);
        assert.ok(evidence.every((item) => item.expiresAt <= new Date()));
      } finally { await barrier.query("rollback"); barrier.release(); }
    });

    await t.test("cancellation and changed rights are rechecked before worker persistence", async () => {
      const f = await fixture();
      const job = await queued(f);
      await db.update(sourceConnection).set({ rightsJson: { ...rights, commercialUse: false } }).where(eq(sourceConnection.id, f.source.id));
      await assert.rejects(completeExistingAcquisition({ ...f.input, jobId: job.id }), /source-rights-denied/);
      await cancelAcquisitionJob({ clientId: f.tenant.id, id: job.id, now: new Date() });
      await assert.rejects(completeExistingAcquisition({ ...f.input, jobId: job.id }), /running-acquisition-job-not-found/);
      assert.equal((await db.select().from(sourceAcquisitionReceipt).where(and(eq(sourceAcquisitionReceipt.clientId, f.tenant.id), eq(sourceAcquisitionReceipt.jobId, job.id)))).length, 1);
      await revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date() });
      assert.equal(await failExistingAcquisition({ clientId: f.tenant.id, sourceConnectionId: f.source.id, jobId: job.id, errorCode: "late-worker", now: new Date() }), false);
      const [source] = await db.select().from(sourceConnection).where(eq(sourceConnection.id, f.source.id));
      assert.equal(source.health, "unavailable");
    });

    await t.test("research loads tenant context and rejects changed project or solution snapshots", async () => {
      const first = await fixture();
      const second = await fixture(first.tenant);
      const outsider = await fixture();
      const one = await persistAcquisition(first.input);
      const two = await persistAcquisition(second.input);
      const [user] = await db.insert(appUser).values({ email: "researcher@example.invalid", name: "Synthetic researcher", role: "researcher", ssoSubjectId: randomUUID() }).returning();
      const now = new Date();
      const [project] = await db.insert(researchProject).values({ clientId: first.tenant.id, name: "Synthetic decision", decision: "Choose the next bounded category study.", markets: ["DK"], languages: ["da"], createdBy: user.id, updatedAt: now }).returning();
      const [record] = await db.insert(intelligenceRecord).values({ clientId: first.tenant.id, kind: "fact", title: "Reviewed category context", statement: "A descriptive category pattern warrants research.", lifecycle: "live", reviewState: "accepted", evidenceIds: [...one.evidenceIds], contradictionIds: [], dependencyIds: [], applicabilityJson: first.input.applicability, confidence: 0.8, uncertainty: ["Synthetic fixture only."], synthesisBy: "human", reviewedBy: user.id, reviewedAt: now }).returning();
      const profile = { enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }], providerBindings: { first: first.source.connectorId, second: second.source.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } };
      const solution = await createActiveSolutionProfile({ clientId: first.tenant.id, createdBy: user.id, profile });
      const sources = await loadResearchContextSources({ clientId: first.tenant.id, projectId: project.id, evidenceIds: two.evidenceIds });
      assert.equal(sources.project?.decision, project.decision);
      assert.equal(sources.solution?.id, String(solution.databaseId));
      assert.deepEqual(sources.intelligence.map((item) => item.id), [String(record.id)]);
      assert.deepEqual(sources.evidence.map((item) => Number(item.id)).sort(), [...one.evidenceIds, ...two.evidenceIds].sort());
      const foreign = await loadResearchContextSources({ clientId: outsider.tenant.id, projectId: project.id });
      assert.equal(foreign.project, null);
      assert.equal(foreign.solution, null);
      assert.equal(foreign.intelligence.length, 0);
      const brief = await runContextualResearch({ clientId: String(first.tenant.id), abilityId: "market-category-diagnosis", question: project.decision, projectId: String(project.id), now: new Date().toISOString(), sources,
        analysis: { pointOfView: "The category merits a bounded study.", clientRelevance: "Supports the selected category decision.", recommendation: "Validate with independent research.", nextDecision: "Choose the study scope.", claimMode: "descriptive", evidenceIds: [...one.evidenceIds, ...two.evidenceIds].map(String), contradictions: [], uncertainty: ["Synthetic descriptive evidence."] },
      });
      assert.equal(brief.status, "ready");
      const input = { clientId: first.tenant.id, createdBy: user.id, projectId: project.id, brief };
      const saved = await saveDecisionBrief(input);
      assert.deepEqual(saved.brief.contextBasis, JSON.parse(JSON.stringify(brief.contextBasis)));
      await assert.rejects(saveDecisionBrief({ ...input, projectId: undefined }), /research-context-changed/);
      await db.update(researchProject).set({ updatedAt: new Date(now.getTime() + 1000) }).where(eq(researchProject.id, project.id));
      await assert.rejects(saveDecisionBrief(input), /research-context-changed/);
      await db.update(researchProject).set({ updatedAt: now }).where(eq(researchProject.id, project.id));
      await createActiveSolutionProfile({ clientId: first.tenant.id, createdBy: user.id, profile });
      await assert.rejects(saveDecisionBrief(input), /research-context-changed/);
      await db.update(researchProject).set({ status: "archived" }).where(eq(researchProject.id, project.id));
      await assert.rejects(saveDecisionBrief(input), /active-project-scope-mismatch/);
      await revokeSourceConnection({ clientId: first.tenant.id, id: first.source.id, now: new Date() });
      const revoked = await loadResearchContextSources({ clientId: first.tenant.id, projectId: project.id });
      assert.equal(revoked.sourceBindings[first.source.connectorId], undefined);
    });
  } finally {
    await probe.end();
    await (globalThis as unknown as { pgPool: Pool }).pgPool.end();
  }
});
