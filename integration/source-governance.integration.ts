import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq, inArray, sql } from "drizzle-orm";
import { acquisitionAuthorization, appUser, authSession, client, clientMembership, canonicalEvidence, citation, researchArtifact, researchProject, intelligenceRecord, monitoringRun, sensingProfile, solutionProfile, sourceConnection, sourceAcquisitionJob, sourceAcquisitionReceipt, governanceAudit, quantitativeObservation } from "../src/db/schema";
import { AcquisitionAdapterRegistry } from "../src/evidence/registry";
import { AggregateMetricEvidenceAdapter, PublicWebEvidenceAdapter } from "../src/evidence/adapters";
import type { SourceConnectionPolicy } from "../src/core/contracts";
import { dueBriefingWindows } from "../src/monitoring/briefings";
import { startTestHttpServer } from "./http-server";
import { newSessionToken, sessionTokenHash, SESSION_MAX_AGE_SECONDS } from "../src/lib/authTokens";
import { PREFLIGHT_DIMENSIONS } from "../src/campaigns/preflightFields";
import type { ContextualPreflight } from "../src/campaigns/preflight";
import type { CampaignResultAssessment } from "../src/campaigns/results";
import { runSynthesisBudgetCases } from "./synthesis-budget-cases";
import { runSynthesisProviderCases } from "./synthesis-provider-cases";
import { runBudgetAdministrationCases } from "./budget-administration-cases";
import { runCompanyContextCases } from "./company-context-cases";
import { runCanonicalWorkerRuntimeCases } from "./canonical-worker-runtime-cases";
import { runBoundedRetentionCases } from "./retention-bounded-cases";

// Refuse accidental execution against the application's database. No tables are
// truncated: each test creates uniquely named, synthetic tenant/source fixtures.
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test");
process.env.DATABASE_URL = url;
if (process.env.NODE_ENV === "production") throw new Error("Integration tests must not run in production mode");

const { db } = await import("../src/db/client");
const { createSourceConnection, listSourceConnections, revokeSourceConnection } = await import("../src/db/queries/sources");
const { persistAcquisition, completeExistingAcquisition, failExistingAcquisition, listCanonicalEvidence } = await import("../src/db/queries/canonical_evidence");
const { ACQUISITION_DISPATCH_LEASE_MS, claimAcquisitionJob, cancelAcquisitionJob, requestAcquisitionJobCancellation } = await import("../src/db/queries/acquisition_execution");
const { loadResearchContextSources } = await import("../src/db/queries/research_context");
const { createActiveSolutionProfile } = await import("../src/db/queries/solution_profiles");
const { listDecisionBriefs, saveDecisionBrief, createCampaignLearningCandidate, createIntelligenceCandidate, promoteCampaignLearning, reviewIntelligenceRecord } = await import("../src/db/queries/workspace_intelligence");
const { runContextualResearch } = await import("../src/abilities/synthesis");
const { createActiveSensingProfile } = await import("../src/db/queries/monitoring");
const { generateDueBriefings, listPeriodicBriefings, reviewPeriodicBriefing } = await import("../src/db/queries/briefings");
const { createAuthSession, resolveAuthSession, revokeAuthSession, purgeAuthSessions, resolveProvisionedIdentity } = await import("../src/db/queries/auth_sessions");
const { setClientAccess } = await import("../src/db/queries/client_access");
const { setAcquisitionBudget, inspectAcquisitionBudget, authorizeAcquisitionAttempt } = await import("../src/db/queries/acquisition_budget");
const { dispatchQueuedAcquisitions, processAcquisitionJob, reconcileStaleAcquisitions } = await import("../src/workers/acquisitionQueue");
const { enforceCanonicalRetention } = await import("../src/db/queries/retention");
const { createCampaignRecord, createMeasurementPlanRecord, reviewMeasurementPlan, createCampaignAssessmentRecord, transitionCampaignRecord, listCampaignWorkspace, reviseCampaignScopes } = await import("../src/db/queries/campaign_workspace");
const probe = new Pool({ connectionString: url });
const rights = { basis: "public_permitted" as const, commercialUse: true, quotationAllowed: false, restrictions: [] };
const policy: SourceConnectionPolicy = {
  permissions: ["read:reports"], dataClassifications: ["public"], permittedPurposes: ["market-research"],
  markets: ["DK"], languages: ["da"], cadence: "manual", lookbackDays: 30, quota: 5, costLimit: 0,
};

const CONTRACTED_LEGACY_RELATIONS = [
  "ability_manifest", "market", "brand", "brand_market", "research_instruction", "channel",
  "insight_route", "research_run", "evidence", "insight", "insight_evidence", "audit_log",
] as const;
const CONTRACTED_LEGACY_TYPES = ["channel_type", "insight_delivery_status", "research_run_status"] as const;

async function assertR1bContractedSchema() {
  const { rows: [head] } = await probe.query<{ migration_count: number }>(
    "select count(*)::int migration_count from drizzle.__drizzle_migrations",
  );
  assert.equal(head.migration_count, 20, "canonical integration must run at the R1B migration head");
  for (const relation of CONTRACTED_LEGACY_RELATIONS) {
    assert.equal(await probe.query("select to_regclass($1)::text relation", [`public.${relation}`]).then((result) => result.rows[0].relation), null,
      `${relation} must not exist in the active R1B schema`);
  }
  for (const type of CONTRACTED_LEGACY_TYPES) {
    assert.equal(await probe.query("select to_regtype($1)::text type", [`public.${type}`]).then((result) => result.rows[0].type), null,
      `${type} must not exist in the active R1B schema`);
  }
  assert.equal(await probe.query(`
    select exists (
      select 1 from information_schema.columns
       where table_schema='public' and column_name='author_handle'
    ) present
  `).then((result) => result.rows[0].present), false, "active schema must not retain author_handle");
}

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
    await t.test("fresh schema is contracted at the R1B head", assertR1bContractedSchema);
    await runCanonicalWorkerRuntimeCases(t, db, probe, url, fixture);
    await runBoundedRetentionCases(t, db, probe, fixture);
    await runSynthesisBudgetCases(t, db, probe);
    await runSynthesisProviderCases(t, db, probe, async () => { const first = await fixture(); return { first, second: await fixture(first.tenant) }; });
    await runBudgetAdministrationCases(t, db, probe);
    await runCompanyContextCases(t, db, probe, async () => { const first = await fixture(); return { first, second: await fixture(first.tenant) }; });
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

    await t.test("revocation immediately hides evidence and blocks intelligence creation and acceptance", async () => {
      const f = await fixture();
      const retained = await persistAcquisition(f.input);
      assert.deepEqual((await listCanonicalEvidence(f.tenant.id)).map((item) => item.id), [...retained.evidenceIds]);
      const candidateInput = {
        clientId: f.tenant.id,
        kind: "fact" as const,
        title: "Synthetic candidate",
        statement: "A bounded synthetic observation.",
        evidenceIds: retained.evidenceIds,
        contradictionIds: [],
        dependencyIds: [],
        applicability: f.input.applicability,
        confidence: 0.7,
        uncertainty: ["Synthetic integration evidence."],
        now: new Date(),
      };
      const candidate = await createIntelligenceCandidate(candidateInput);
      const [reviewer] = await db.insert(appUser).values({ email: `evidence-reviewer-${randomUUID()}@example.invalid`, name: "Synthetic reviewer", role: "reviewer", ssoSubjectId: randomUUID() }).returning();
      await revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date() });
      assert.deepEqual(await listCanonicalEvidence(f.tenant.id), []);
      await assert.rejects(createIntelligenceCandidate({ ...candidateInput, title: "Rejected after revocation" }), /evidence-use-denied:source-(revoked|unavailable)/);
      await assert.rejects(reviewIntelligenceRecord({ clientId: f.tenant.id, id: Number(candidate.id), reviewerUserId: reviewer.id, decision: "accepted", now: new Date() }), /evidence-use-denied:source-(revoked|unavailable)/);
      const [stored] = await db.select().from(intelligenceRecord).where(eq(intelligenceRecord.id, Number(candidate.id)));
      assert.equal(stored.reviewState, "pending");
    });

    await t.test("evidence use rechecks database time after a lock wait crosses expiry", async () => {
      const f = await fixture();
      const retained = await persistAcquisition(f.input);
      await db.update(canonicalEvidence).set({ expiresAt: sql`clock_timestamp() + interval '1500 milliseconds'` })
        .where(eq(canonicalEvidence.id, retained.evidenceIds[0]));
      const blocker = await probe.connect();
      try {
        await blocker.query("begin");
        await blocker.query("select id from source_connection where id = $1 for update", [f.source.id]);
        const rejected = assert.rejects(createIntelligenceCandidate({
          clientId: f.tenant.id,
          kind: "fact",
          title: "Must expire while blocked",
          statement: "This candidate must not cross the evidence expiry boundary.",
          evidenceIds: retained.evidenceIds,
          contradictionIds: [],
          dependencyIds: [],
          applicability: f.input.applicability,
          confidence: 0.7,
          uncertainty: ["Synthetic integration evidence."],
          now: new Date(),
        }), /evidence-use-denied:expired/);
        await waitForBlocked(1);
        await new Promise((resolve) => setTimeout(resolve, 1_600));
        await blocker.query("commit");
        await rejected;
        const stored = await db.select().from(intelligenceRecord).where(and(
          eq(intelligenceRecord.clientId, f.tenant.id),
          eq(intelligenceRecord.title, "Must expire while blocked"),
        ));
        assert.equal(stored.length, 0);
      } finally {
        await blocker.query("rollback");
        blocker.release();
      }
    });

    await t.test("source revocation and its redacted audit are atomic and idempotent", async () => {
      const f = await fixture();
      const [actor] = await db.insert(appUser).values({
        email: `revocation-auditor-${randomUUID()}@example.invalid`,
        name: "Synthetic revocation auditor",
        role: "admin",
        ssoSubjectId: randomUUID(),
      }).returning();
      const now = new Date();
      const revoked = await revokeSourceConnection({
        clientId: f.tenant.id,
        id: f.source.id,
        now,
        audit: { actorUserId: actor.id, reason: "Requested by person@example.invalid after rights review." },
      });
      assert.equal(revoked?.cleanupPending, true);
      const audits = await db.select().from(governanceAudit).where(and(
        eq(governanceAudit.clientId, f.tenant.id),
        eq(governanceAudit.entityType, "source_connection"),
        eq(governanceAudit.entityId, String(f.source.id)),
        eq(governanceAudit.action, "revoke"),
      ));
      assert.equal(audits.length, 1);
      assert.equal(audits[0].actorUserId, actor.id);
      assert.equal((audits[0].redactedAfterJson as { reason: string }).reason.includes("person@example.invalid"), false);
      assert.match((audits[0].redactedAfterJson as { reason: string }).reason, /redacted-email/);
      await revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date(now.getTime() + 1_000), audit: { actorUserId: actor.id, reason: "retry" } });
      assert.equal((await db.select().from(governanceAudit).where(and(
        eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.entityId, String(f.source.id)), eq(governanceAudit.action, "revoke"),
      ))).length, 1, "idempotent retry does not duplicate the audit event");

      const rollback = await fixture();
      await assert.rejects(revokeSourceConnection({
        clientId: rollback.tenant.id,
        id: rollback.source.id,
        now,
        audit: { actorUserId: 2_147_483_647, reason: "synthetic audit failure" },
      }), (error: unknown) => error instanceof Error
        && /governance_audit/.test(error.message)
        && /foreign key|violates/i.test(String(error.cause)));
      const [unchanged] = await db.select().from(sourceConnection).where(eq(sourceConnection.id, rollback.source.id));
      assert.equal(unchanged.revokedAt, null);
      assert.equal(unchanged.health, "configured");
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
        const revocation = await revoked;
        assert.equal(revocation?.cleanupPending, true);
        await rejected;
        assert.equal((await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.sourceConnectionId, f.source.id))).length, 0);
        assert.equal((await db.select().from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, job.id))).length, 0, "revocation does not synchronously fan out");
        const cleanup = await reconcileStaleAcquisitions(new Date());
        assert.equal(cleanup.revokedCancelled, 1);
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
        const revocation = await revoked;
        assert.equal(revocation?.cleanupPending, true);
        const [source] = await db.select().from(sourceConnection).where(eq(sourceConnection.id, f.source.id));
        assert.equal(source.health, "unavailable");
        assert.ok(source.revokedAt);
        const evidence = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.sourceConnectionId, f.source.id));
        assert.equal(evidence.length, 1);
        assert.ok(evidence.every((item) => item.expiresAt > new Date()), "revocation remains an O(1) source transition");
        let retention;
        do { retention = await enforceCanonicalRetention(new Date(), f.tenant.id); }
        while (retention.batchFull);
        const retained = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.sourceConnectionId, f.source.id));
        assert.ok(retained.every((item) => item.lifecycle === "expired"));
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

    await t.test("administrative acquisition cancellation is tenant-scoped and unknown-outcome safe", async () => {
      const owner = await fixture();
      const outsider = await fixture();
      const job = await queued(owner);
      const [user] = await db.insert(appUser).values({ email: `cancellation-${randomUUID()}@example.invalid`, name: "Cancellation researcher", role: "researcher", ssoSubjectId: randomUUID() }).returning();
      await db.insert(clientMembership).values({ clientId: owner.tenant.id, userId: user.id, role: "researcher" });
      const now = new Date();
      assert.equal(await requestAcquisitionJobCancellation({ clientId: outsider.tenant.id, actorUserId: user.id, id: job.id, now }), "unavailable");
      assert.equal(await requestAcquisitionJobCancellation({ clientId: owner.tenant.id, actorUserId: user.id, id: job.id, now }), "cancelled");
      assert.equal(await requestAcquisitionJobCancellation({ clientId: owner.tenant.id, actorUserId: user.id, id: job.id, now: new Date(now.getTime() + 1_000) }), "already_cancelled");
      const receipts = await db.select().from(sourceAcquisitionReceipt).where(and(
        eq(sourceAcquisitionReceipt.clientId, owner.tenant.id),
        eq(sourceAcquisitionReceipt.jobId, job.id),
      ));
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].errorCode, "cancelled-by-user");
      const audits = await db.select().from(governanceAudit).where(and(
        eq(governanceAudit.clientId, owner.tenant.id),
        eq(governanceAudit.entityType, "source_acquisition_job"),
        eq(governanceAudit.entityId, String(job.id)),
      ));
      assert.equal(audits.length, 1, "cancellation and its redacted audit are atomic and retry-safe");

      if (process.env.TEST_HTTP === "1") {
        const allowedJob = await queued(owner);
        const foreignJob = await queued(outsider);
        const [viewer] = await db.insert(appUser).values({ email: `cancellation-viewer-${randomUUID()}@example.invalid`, name: "Cancellation viewer", role: "viewer", ssoSubjectId: randomUUID() }).returning();
        await db.insert(clientMembership).values({ clientId: owner.tenant.id, userId: viewer.id, role: "viewer" });
        const token = await createAuthSession(user.id, owner.tenant.id);
        const viewerToken = await createAuthSession(viewer.id, owner.tenant.id);
        const server = await startTestHttpServer(url!);
        try {
          assert.equal((await server.request(`/api/acquisition/jobs/${allowedJob.id}/cancel`, undefined, {})).status, 403);
          assert.equal((await server.request(`/api/acquisition/jobs/${allowedJob.id}/cancel`, viewerToken, {})).status, 403);
          const foreign = await server.request(`/api/acquisition/jobs/${foreignJob.id}/cancel`, token, {});
          const missing = await server.request("/api/acquisition/jobs/2147483647/cancel", token, {});
          assert.equal(foreign.status, 409);
          assert.equal(missing.status, 409);
          assert.deepEqual(await foreign.json(), await missing.json(), "foreign and missing jobs are non-disclosing");
          const first = await server.request(`/api/acquisition/jobs/${allowedJob.id}/cancel`, token, {});
          assert.equal(first.status, 200);
          assert.equal((await first.json()).replayed, false);
          const replay = await server.request(`/api/acquisition/jobs/${allowedJob.id}/cancel`, token, {});
          assert.equal(replay.status, 200);
          assert.equal((await replay.json()).replayed, true);
          assert.equal((await server.request(`/api/monitoring/jobs/${allowedJob.id}/cancel`, token, {})).status, 404);
        } finally {
          await server.stop();
        }
      }
    });

    await t.test("research snapshots reject changed context and expiry during concurrent persistence", async () => {
      const first = await fixture();
      const second = await fixture(first.tenant);
      const outsider = await fixture();
      const one = await persistAcquisition(first.input);
      const two = await persistAcquisition(second.input);
      const [user] = await db.insert(appUser).values({ email: "researcher@example.invalid", name: "Synthetic researcher", role: "researcher", ssoSubjectId: randomUUID() }).returning();
      const now = new Date();
      const [project] = await db.insert(researchProject).values({ clientId: first.tenant.id, name: "Synthetic decision", decision: "Choose the next bounded category study.", markets: ["DK"], languages: ["da"], createdBy: user.id, updatedAt: now }).returning();
      const [record] = await db.insert(intelligenceRecord).values({ clientId: first.tenant.id, kind: "fact", title: "Reviewed category context", statement: "A descriptive category pattern warrants research.", lifecycle: "live", reviewState: "accepted", evidenceIds: [...one.evidenceIds], contradictionIds: [], dependencyIds: [], applicabilityJson: first.input.applicability, confidence: 0.8, uncertainty: ["Synthetic fixture only."], synthesisBy: "human", reviewedBy: user.id, reviewedAt: now }).returning();
      const [sensing] = await db.insert(sensingProfile).values({ clientId: first.tenant.id, version: 1, status: "active", profileJson: { themes: ["category"], markets: ["DK"] } }).returning();
      const profile = { sensingProfileId: String(sensing.id), enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }], providerBindings: { first: first.source.connectorId, second: second.source.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } };
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
      assert.deepEqual(brief.contextBasis?.evidence?.map((item) => item.id).sort(), brief.evidenceIds.slice().sort());
      await assert.rejects(saveDecisionBrief({ ...input, brief: { ...brief, contextBasis: undefined } }), /research-context-changed/);
      const [originalEvidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, one.evidenceIds[0]));
      const originalSource = await db.select().from(sourceConnection).where(eq(sourceConnection.id, first.source.id));
      const variants: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
        ["changed statement", () => db.update(intelligenceRecord).set({ statement: "A materially changed strategy." }).where(eq(intelligenceRecord.id, record.id)), () => db.update(intelligenceRecord).set({ statement: record.statement }).where(eq(intelligenceRecord.id, record.id))],
        ["expired intelligence", () => db.update(intelligenceRecord).set({ decayAt: new Date(0) }).where(eq(intelligenceRecord.id, record.id)), () => db.update(intelligenceRecord).set({ decayAt: null }).where(eq(intelligenceRecord.id, record.id))],
        ["withdrawn review", () => db.update(intelligenceRecord).set({ reviewState: "revision_requested" }).where(eq(intelligenceRecord.id, record.id)), () => db.update(intelligenceRecord).set({ reviewState: record.reviewState }).where(eq(intelligenceRecord.id, record.id))],
        ["changed evidence", () => db.update(canonicalEvidence).set({ sourceContent: "Changed findings with unchanged legacy content hash." }).where(eq(canonicalEvidence.id, originalEvidence.id)), () => db.update(canonicalEvidence).set({ sourceContent: originalEvidence.sourceContent }).where(eq(canonicalEvidence.id, originalEvidence.id))],
        ["changed method", () => db.update(canonicalEvidence).set({ methodJson: { method: "Different sample", limitations: ["Changed universe"] } }).where(eq(canonicalEvidence.id, originalEvidence.id)), () => db.update(canonicalEvidence).set({ methodJson: originalEvidence.methodJson }).where(eq(canonicalEvidence.id, originalEvidence.id))],
        ["quarantined evidence", () => db.update(canonicalEvidence).set({ lifecycle: "quarantined" }).where(eq(canonicalEvidence.id, originalEvidence.id)), () => db.update(canonicalEvidence).set({ lifecycle: originalEvidence.lifecycle }).where(eq(canonicalEvidence.id, originalEvidence.id))],
        ["source purpose removed", () => db.update(sourceConnection).set({ configurationJson: { ...policy, permittedPurposes: ["other"] } }).where(eq(sourceConnection.id, first.source.id)), () => db.update(sourceConnection).set({ configurationJson: originalSource[0].configurationJson }).where(eq(sourceConnection.id, first.source.id))],
        ["source rights removed", () => db.update(sourceConnection).set({ rightsJson: { ...rights, commercialUse: false } }).where(eq(sourceConnection.id, first.source.id)), () => db.update(sourceConnection).set({ rightsJson: rights }).where(eq(sourceConnection.id, first.source.id))],
        ["source revoked", () => db.update(sourceConnection).set({ health: "unavailable" }).where(eq(sourceConnection.id, first.source.id)), () => db.update(sourceConnection).set({ health: originalSource[0].health }).where(eq(sourceConnection.id, first.source.id))],
        ["changed sensing", () => db.update(sensingProfile).set({ profileJson: { ...sensing.profileJson as object, themes: ["different priority"] } }).where(eq(sensingProfile.id, sensing.id)), () => db.update(sensingProfile).set({ profileJson: sensing.profileJson }).where(eq(sensingProfile.id, sensing.id))],
      ];
      for (const [name, change, restore] of variants) {
        await change();
        await assert.rejects(saveDecisionBrief({ ...input, brief: { ...brief, id: randomUUID() } }), /research-context-changed/, name);
        await restore();
      }
      assert.equal((await db.select().from(researchArtifact).where(eq(researchArtifact.clientId, first.tenant.id))).length, 1);
      assert.equal((await db.select().from(citation).where(eq(citation.artifactId, saved.id))).length, brief.citations.length);
      assert.equal((await saveDecisionBrief(input)).id, saved.id);

      // A concurrent strategy edit wins its row lock; the waiting save must observe the change.
      const editor = await probe.connect();
      try {
        await editor.query("begin");
        await editor.query("update intelligence_record set statement = $1 where id = $2", ["Concurrent reviewed strategy edit.", record.id]);
        const saving = assert.rejects(saveDecisionBrief({ ...input, brief: { ...brief, id: randomUUID() } }), /research-context-changed/);
        await waitForBlocked(1);
        await editor.query("commit");
        await saving;
      } finally { await editor.query("rollback"); editor.release(); }
      await db.update(intelligenceRecord).set({ statement: record.statement }).where(eq(intelligenceRecord.id, record.id));

      if (process.env.TEST_HTTP === "1") {
        await db.insert(clientMembership).values({ clientId: first.tenant.id, userId: user.id, role: "researcher" });
        const token = await createAuthSession(user.id, first.tenant.id);
        const server = await startTestHttpServer(url!);
        const changing = await probe.connect();
        try {
          await changing.query("begin");
          await changing.query("update intelligence_record set statement = $1 where id = $2", ["Concurrent API strategy edit.", record.id]);
          const response = server.request("/api/workspace/briefs", token, { projectId: project.id, abilityId: brief.abilityId, question: project.decision,
            evidenceIds: brief.evidenceIds, pointOfView: brief.pointOfView, clientRelevance: brief.clientRelevance, recommendation: brief.recommendation,
            nextDecision: brief.nextDecision, claimMode: "descriptive", market: "DK", language: "da" });
          await waitForBlocked(1);
          await changing.query("commit");
          const conflict = await response;
          assert.equal(conflict.status, 409);
          assert.deepEqual(await conflict.json(), { error: "Research context changed during analysis. Refresh and run again." });
        } finally { await changing.query("rollback"); changing.release(); await server.stop(); }
        await db.update(intelligenceRecord).set({ statement: record.statement }).where(eq(intelligenceRecord.id, record.id));
      }

      // Hold the insert after snapshot validation. Expiry while waiting must roll back both
      // artifact and citations; retention must skip the evidence lock, report
      // continuation, and resume after the concurrent writer releases it.
      const expiresAt = new Date(Date.now() + 1500);
      await db.update(canonicalEvidence).set({ expiresAt }).where(eq(canonicalEvidence.id, originalEvidence.id));
      const expiringSources = await loadResearchContextSources({ clientId: first.tenant.id, projectId: project.id });
      const expiringBrief = await runContextualResearch({ clientId: String(first.tenant.id), abilityId: brief.abilityId, question: project.decision, projectId: String(project.id), now: new Date().toISOString(), sources: expiringSources,
        analysis: { pointOfView: brief.pointOfView, clientRelevance: brief.clientRelevance, recommendation: brief.recommendation, nextDecision: brief.nextDecision, claimMode: "descriptive", evidenceIds: brief.evidenceIds, contradictions: [], uncertainty: [] } });
      assert.equal(expiringBrief.status, "ready");
      const projected = await listDecisionBriefs(first.tenant.id, project.id, new Date(expiresAt.getTime() + 1));
      const stale = projected.find((item) => item.id === saved.id);
      assert.equal(stale?.basisStatus, "stale");
      assert.equal(stale?.quarantined, true);
      assert.equal(stale?.brief.status, "needs_context");
      assert.deepEqual(stale?.brief.citations, []);
      assert.ok(!JSON.stringify(stale?.brief).includes("The category merits a bounded study."));
      const barrier = await probe.connect();
      try {
        await barrier.query("begin");
        await barrier.query("lock table research_artifact in share mode");
        const blockedSave = assert.rejects(saveDecisionBrief({ ...input, brief: { ...expiringBrief, id: randomUUID() } }), /research-context-changed/);
        await waitForBlocked(1);
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 30));
        const deferredRetention = await enforceCanonicalRetention(new Date(), first.tenant.id);
        assert.equal(deferredRetention.evidenceExpired, 0);
        assert.equal(deferredRetention.batchFull, true, "locked due evidence remains visible as continuation work");
        await barrier.query("commit");
        await blockedSave;
      } finally { await barrier.query("rollback"); barrier.release(); }
      let retention;
      do { retention = await enforceCanonicalRetention(new Date(), first.tenant.id); }
      while (retention.batchFull);
      assert.equal((await db.select().from(researchArtifact).where(eq(researchArtifact.clientId, first.tenant.id))).length, 1);
      const [redactedCitation] = await db.select().from(citation).where(and(eq(citation.artifactId, saved.id), eq(citation.evidenceId, originalEvidence.id)));
      assert.equal(redactedCitation.safeReference, "[expired evidence]");
      // Restore this synthetic row so the remaining independent project/version assertions apply.
      await db.update(canonicalEvidence).set(originalEvidence).where(eq(canonicalEvidence.id, originalEvidence.id));
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

    await t.test("durable briefing catch-up is idempotent, tenant-scoped, review-gated and source-aware", async () => {
      const f = await fixture();
      const other = await fixture();
      await persistAcquisition(f.input);
      const [user] = await db.insert(appUser).values({ email: "reviewer@example.invalid", name: "Synthetic reviewer", role: "reviewer", ssoSubjectId: randomUUID() }).returning();
      const sensing = await createActiveSensingProfile({ clientId: String(f.tenant.id), themes: ["category"], markets: ["DK"], competitors: [], products: [], audiences: [], occasions: [], risks: [], sourceConnectionIds: [f.source.connectorId], cadence: "weekly", lookbackDays: 30, materialityThreshold: 0.2, noveltyThreshold: 0.2, confidenceThreshold: 0.7, freshnessDays: 14, expiryDays: 30, minimumCorroboration: 1, deduplicationWindowDays: 30, seasonalExpectations: {}, suppressionRules: ["duplicate", "bot-heavy", "manipulation-risk", "low-sample", "stale"], downRankingRules: [], destinations: ["owned-product"], humanReviewRequired: true, decisionContexts: ["market-planning"], quietPeriods: [] });
      const profile = { enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }], providerBindings: { first: f.source.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 }, sensingProfileId: sensing.profile.id, briefingCadences: ["weekly"] as const };
      const configured = await createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, profile });
      // Activation precedes the synthetic receipt by a second so the first partial period covers it.
      assert.ok(f.input.result.receipt.completedAt);
      const activatedAt = new Date(Date.parse(f.input.result.receipt.completedAt) - 1000);
      await db.update(solutionProfile).set({ createdAt: activatedAt }).where(eq(solutionProfile.id, configured.databaseId));
      const [run] = await db.insert(monitoringRun).values({ clientId: f.tenant.id, sensingProfileId: sensing.databaseId, scheduleKey: randomUUID(), status: "succeeded", outcome: "no_material_change", finishedAt: new Date() }).returning();
      const window = dueBriefingWindows("weekly", activatedAt.toISOString(), new Date(Date.now() + 8 * 86_400_000).toISOString())[0];
      const now = new Date(window.end);
      const concurrent = await Promise.all([generateDueBriefings(now, f.tenant.id), generateDueBriefings(now, f.tenant.id)]);
      assert.equal(concurrent.reduce((count, item) => count + item.created, 0), 1);
      const [packet] = await listPeriodicBriefings(f.tenant.id, now);
      assert.equal(packet.status, "pending_review");
      assert.equal(packet.briefing.outcome, "no_material_change");
      assert.equal(packet.currentEvidenceAvailable, true);
      assert.equal(packet.briefing.monitoring[0].id, run.id);
      assert.deepEqual(await listPeriodicBriefings(other.tenant.id, now), []);
      const reviewInput = { clientId: f.tenant.id, id: packet.id, reviewerUserId: user.id, decision: "accepted" as const, now };
      assert.equal(await reviewPeriodicBriefing({ ...reviewInput, clientId: other.tenant.id }), false);

      // The dormant domain remains covered directly, while every former production surface stays absent.
      if (process.env.TEST_HTTP === "1") {
        const server = await startTestHttpServer(url!);
        try {
          await db.insert(clientMembership).values([{ userId: user.id, clientId: f.tenant.id, role: "reviewer" }, { userId: user.id, clientId: other.tenant.id, role: "reviewer" }]);
          const session = await createAuthSession(user.id, f.tenant.id);
          const viewerIdentity = await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject: randomUUID(), role: "viewer" });
          const viewer = await createAuthSession(viewerIdentity.userId!, f.tenant.id);
          const otherSession = await createAuthSession(user.id, other.tenant.id);
          for (const response of [
            await server.request("/api/monitoring/briefings"),
            await server.request("/api/monitoring/briefings", viewer),
            await server.request(`/api/monitoring/briefings/${packet.id}/review`, session, { decision: "accepted" }),
            await server.request("/api/monitoring/briefings/settings", session, { profileId: configured.databaseId, cadences: [] }),
            await server.request(`/api/monitoring/briefings/${packet.id}/review`, otherSession, { decision: "accepted" }),
            await server.request("/monitoring", viewer),
          ]) assert.equal(response.status, 404);
        } finally { await server.stop(); }
      }
      const reviews = await Promise.all([reviewPeriodicBriefing(reviewInput), reviewPeriodicBriefing(reviewInput)]);
      assert.equal(reviews.filter(Boolean).length, 1);
      assert.equal((await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.entityId, String(packet.id)), eq(governanceAudit.action, "briefing_reviewed")))).length, 1);
      assert.equal((await db.select().from(intelligenceRecord).where(eq(intelligenceRecord.clientId, f.tenant.id))).length, 0);
      // A missed week is produced as an explicit gap, not silently called no change.
      const later = new Date(now.getTime() + 7 * 86_400_000);
      assert.equal((await generateDueBriefings(later, f.tenant.id)).created, 1);
      const [missing] = await listPeriodicBriefings(f.tenant.id, later);
      assert.equal(missing.briefing.outcome, "needs_context");
      await assert.rejects(reviewPeriodicBriefing({ ...reviewInput, id: missing.id, now: later }), /briefing-evidence-incomplete-or-expired/);
      assert.equal(await reviewPeriodicBriefing({ ...reviewInput, id: missing.id, decision: "rejected", now: later }), true);
      await revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now });
      assert.ok((await listPeriodicBriefings(f.tenant.id, later)).every((item) => !item.currentEvidenceAvailable));
      await createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, expectedActiveId: configured.databaseId, profile: { ...profile, briefingCadences: [] } });
      await assert.rejects(createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, expectedActiveId: configured.databaseId, profile }), /active-solution-changed/);
      assert.equal((await generateDueBriefings(new Date(later.getTime() + 30 * 86_400_000), f.tenant.id)).created, 0);
    });

    await t.test("opaque sessions enforce expiry, live permissions, logout and non-reviving membership revocation", async () => {
      const f = await fixture();
      const subject = randomUUID();
      const granted = await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "reviewer" });
      const userId = granted.userId!;
      const now = new Date();
      const token = await createAuthSession(userId, f.tenant.id, now);
      assert.equal((await resolveAuthSession(token, now))?.role, "reviewer");
      assert.equal(await resolveAuthSession(token, new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)), null);
      assert.equal(await resolveAuthSession(token, new Date(now.getTime() - 1)), null);
      assert.equal(await resolveAuthSession(newSessionToken(), now), null);
      const [stored] = await db.select().from(authSession).where(eq(authSession.tokenHash, sessionTokenHash(token)!));
      assert.ok(stored);
      assert.ok(!JSON.stringify(stored).includes(token));
      const identity = { subject, clientSlug: f.tenant.slug, name: "Synthetic operator", email: "operator@example.invalid" };
      assert.equal((await resolveProvisionedIdentity(identity)).role, "reviewer");
      await assert.rejects(resolveProvisionedIdentity({ ...identity, subject: randomUUID() }), /client-access-denied/);
      await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "viewer" });
      assert.equal((await resolveAuthSession(token))?.role, "viewer");
      await setClientAccess({ action: "revoke", clientSlug: f.tenant.slug, subject });
      assert.equal(await resolveAuthSession(token), null);
      await assert.rejects(resolveProvisionedIdentity(identity), /client-access-denied/);
      await assert.rejects(createAuthSession(userId, f.tenant.id), /client-access-denied/);
      await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "reviewer" });
      assert.equal(await resolveAuthSession(token), null);
      const active = await createAuthSession(userId, f.tenant.id);
      const expired = await createAuthSession(userId, f.tenant.id, new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 1) * 1000));
      const future = await createAuthSession(userId, f.tenant.id, new Date(Date.now() + 60_000));
      if (process.env.TEST_HTTP === "1") {
        const server = await startTestHttpServer(url!);
        try {
          for (const invalid of [expired, future, token, newSessionToken(), "legacy.signed.payload", active + ".extra"]) assert.equal((await server.request("/api/projects", invalid)).status, 401);
          assert.equal((await server.request("/api/projects", active)).status, 200);
          assert.equal((await server.request("/api/workspace/intelligence/999999999/promote", active, {})).status, 409);
          await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "viewer" });
          assert.equal((await server.request("/api/workspace/intelligence/999999999/promote", active, {})).status, 403);
          for (const origin of [null, "https://foreign.example", "null"]) assert.equal((await server.request("/api/auth/logout", active, {}, origin)).status, 403);
          assert.equal((await server.request("/api/auth/logout", active)).status, 405);
          assert.equal((await server.request("/api/projects", active)).status, 200);
          const logout = await server.request("/api/auth/logout", active, {});
          assert.equal(logout.status, 303);
          assert.match(logout.headers.get("set-cookie") ?? "", /market_research_session=;/);
          assert.equal((await server.request("/api/projects", active)).status, 401);
          const revoked = await createAuthSession(userId, f.tenant.id);
          await setClientAccess({ action: "revoke", clientSlug: f.tenant.slug, subject });
          assert.equal((await server.request("/api/projects", revoked)).status, 401);
          await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "reviewer" });
          assert.equal((await server.request("/api/projects", revoked)).status, 401);
          assert.equal((await server.request("/api/auth/callback?code=synthetic-invalid-code")).status, 403);
        } finally { await server.stop(); }
      } else {
        await revokeAuthSession(active);
        assert.equal(await resolveAuthSession(active), null);
      }
      await purgeAuthSessions(new Date(Date.now() + (SESSION_MAX_AGE_SECONDS + 120) * 1000));
      assert.equal((await db.select().from(authSession).where(eq(authSession.userId, userId))).length, 0);
    });
    await t.test("session cleanup is bounded, concurrent-safe and preserves non-due sessions", async () => {
      const f = await fixture();
      const now = new Date();
      const [user] = await db.insert(appUser).values({
        email: `session-batch-${randomUUID()}@example.invalid`,
        name: "Synthetic session batch user",
        role: "viewer",
        ssoSubjectId: randomUUID(),
      }).returning();
      await db.insert(clientMembership).values({ clientId: f.tenant.id, userId: user.id, role: "viewer" });
      const prefix = randomUUID();
      const expired = Array.from({ length: 501 }, (_, index) => ({
        tokenHash: `${prefix}-expired-${index}`,
        clientId: f.tenant.id,
        userId: user.id,
        createdAt: new Date(now.getTime() - 20_000),
        expiresAt: new Date(now.getTime() - 10_000),
      }));
      const revoked = Array.from({ length: 501 }, (_, index) => ({
        tokenHash: `${prefix}-revoked-${index}`,
        clientId: f.tenant.id,
        userId: user.id,
        createdAt: new Date(now.getTime() - 20_000),
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: new Date(now.getTime() - 5_000),
      }));
      const activeHash = `${prefix}-active`;
      await db.insert(authSession).values([...expired, ...revoked, {
        tokenHash: activeHash,
        clientId: f.tenant.id,
        userId: user.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      }]);

      const concurrent = await Promise.all([
        purgeAuthSessions(now, { limit: 500 }),
        purgeAuthSessions(now, { limit: 500 }),
      ]);
      assert.equal(concurrent.reduce((sum, item) => sum + item.removed, 0), 1000);
      assert.ok(concurrent.every((item) => item.batchFull));
      assert.deepEqual(await purgeAuthSessions(now, { limit: 500 }), { removed: 2, batchFull: false });
      assert.equal((await db.select().from(authSession).where(eq(authSession.tokenHash, activeHash))).length, 1);
    });
    await t.test("pre-acquisition authorizations serialize across sources, isolate clients and survive configuration edits", async () => {
      const f = await fixture();
      const second = await fixture(f.tenant);
      const other = await fixture();
      const settings = { currency: "DKK", dailyCostMicros: 100, dailyRecords: 1, dailyRequests: 1, enabled: true };
      const plan = { currency: "DKK", maxCostMicros: 100, maxRecords: 1, maxRequests: 1 };
      const registry = new AcquisitionAdapterRegistry();
      let calls = 0;
      let credentials = 0;
      const runtime = { async resolveCredential() { credentials++; return "synthetic-only"; } };
      const enqueue = async (value: typeof f) => (await db.insert(sourceAcquisitionJob).values({ clientId: value.tenant.id, sourceConnectionId: value.source.id, operation: value.input.operation, requestJson: value.input.request, idempotencyKey: randomUUID() }).returning())[0];
      for (const value of [f, second, other]) {
        // No legacy currency-less cost limit; these synthetic plans have explicit DKK micro-units.
        await db.update(sourceConnection).set({ configurationJson: { ...policy, costLimit: undefined } }).where(eq(sourceConnection.id, value.source.id));
        registry.register(value.source.connectorId, () => ({ id: value.source.connectorId, plan: () => plan,
          async run(job, context) {
            context.acquisition!.authorizeRequest({ costMicros: 100, maxRecords: 1 });
            await context.resolveCredential(job.credentialRef!);
            calls++;
            return { ...value.input.result, receipt: { ...value.input.result.receipt, jobId: job.id } };
          },
        }));
      }
      const denied = await enqueue(f);
      assert.equal(await processAcquisitionJob({ databaseJobId: denied.id, registry, runtime }), "failed");
      assert.equal(calls, 0); assert.equal(credentials, 0);
      await setAcquisitionBudget(f.tenant.slug, settings);
      const jobs = await Promise.all([enqueue(f), enqueue(second)]);
      const statuses = await Promise.all(jobs.map((job) => processAcquisitionJob({ databaseJobId: job.id, registry, runtime })));
      assert.deepEqual(statuses.sort(), ["completed", "failed"]);
      assert.equal(calls, 1); assert.equal(credentials, 1);
      const used = await inspectAcquisitionBudget(f.tenant.slug);
      assert.deepEqual(used.usage, { authorizedCostMicros: "100", authorizedRecords: "1", authorizedRequests: "1" });
      await setAcquisitionBudget(f.tenant.slug, settings);
      const unchanged = await enqueue(f);
      assert.equal(await processAcquisitionJob({ databaseJobId: unchanged.id, registry, runtime }), "failed");
      assert.equal(calls, 1);
      await assert.rejects(setAcquisitionBudget(f.tenant.slug, { ...settings, currency: "EUR" }), /budget-currency-change/);
      await setAcquisitionBudget(other.tenant.slug, settings);
      const isolated = await enqueue(other);
      assert.equal(await processAcquisitionJob({ databaseJobId: isolated.id, registry, runtime }), "completed");
      assert.equal(calls, 2);
      const foreign = await queued(f);
      await assert.rejects(authorizeAcquisitionAttempt({ clientId: other.tenant.id, jobId: foreign.id, attempt: 1, plan }), /budget-job-not-found/);
      // Raising one dimension cannot bypass either of the other two dimensions.
      for (const limits of [{ dailyCostMicros: 100, dailyRecords: 10, dailyRequests: 10 }, { dailyCostMicros: 1000, dailyRecords: 1, dailyRequests: 10 }, { dailyCostMicros: 1000, dailyRecords: 10, dailyRequests: 1 }]) {
        await setAcquisitionBudget(f.tenant.slug, { ...settings, ...limits });
        await assert.rejects(authorizeAcquisitionAttempt({ clientId: f.tenant.id, jobId: foreign.id, attempt: 1, plan }), /budget-daily-limit/);
      }
      await setAcquisitionBudget(f.tenant.slug, { ...settings, dailyCostMicros: 1000, dailyRecords: 10, dailyRequests: 10, enabled: false });
      await assert.rejects(authorizeAcquisitionAttempt({ clientId: f.tenant.id, jobId: foreign.id, attempt: 1, plan }), /budget-not-enabled/);
      assert.ok((await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.action, "operator_set_acquisition_budget")))).length > 0);
      // Simulate yesterday's admissions in this isolated fixture, retaining the immutable history.
      await probe.query("update acquisition_authorization set authorized_at = (date_trunc('day', current_timestamp at time zone 'UTC') at time zone 'UTC') - interval '1 second' where client_id = $1", [f.tenant.id]);
      await setAcquisitionBudget(f.tenant.slug, settings);
      const nextDay = await enqueue(f);
      assert.equal(await processAcquisitionJob({ databaseJobId: nextDay.id, registry, runtime }), "completed");
      assert.equal((await inspectAcquisitionBudget(f.tenant.slug)).usage.authorizedRequests, "1");
      assert.equal((await db.select().from(acquisitionAuthorization).where(eq(acquisitionAuthorization.clientId, f.tenant.id))).length, 2);
    });

    await t.test("worker retry, cancellation, missing plans and output failures cannot reuse or refund authorization", async () => {
      const settings = { currency: "DKK", dailyCostMicros: 0, dailyRecords: 5, dailyRequests: 1, enabled: true };
      const plan = { currency: "DKK", maxCostMicros: 0, maxRecords: 1, maxRequests: 1 };
      const runtime = { async resolveCredential() { throw new Error("credentials-must-not-be-resolved"); } };
      const enqueue = async (f: Awaited<ReturnType<typeof fixture>>) => (await db.insert(sourceAcquisitionJob).values({ clientId: f.tenant.id, sourceConnectionId: f.source.id, operation: f.input.operation, requestJson: f.input.request, idempotencyKey: randomUUID() }).returning())[0];
      for (const mode of ["missing-plan", "oversized-plan", "currency-mismatch", "unknown-outcome", "cancelled", "bad-output", "retry-success", "unmetered"] as const) {
        const f = await fixture();
        const job = await enqueue(f);
        await setAcquisitionBudget(f.tenant.slug, { ...settings, dailyRequests: mode === "retry-success" ? 2 : 1 });
        const registry = new AcquisitionAdapterRegistry();
        let calls = 0;
        registry.register(f.source.connectorId, () => ({ id: f.source.connectorId,
          ...(mode === "missing-plan" ? {} : { plan: () => ({ ...plan, maxRecords: mode === "oversized-plan" ? 6 : 1, currency: mode === "currency-mismatch" ? "EUR" : "DKK" }) }),
          async run(domainJob, context) {
            calls++;
            if (mode !== "unmetered") context.acquisition!.authorizeRequest({ costMicros: 0, maxRecords: 1 });
            if (mode === "unknown-outcome" || (mode === "retry-success" && calls === 1)) throw new Error("transient");
            if (mode === "cancelled") {
              await cancelAcquisitionJob({ clientId: f.tenant.id, id: job.id, now: new Date() });
              throw new Error("acquisition-cancelled");
            }
            const receipt = { ...f.input.result.receipt, jobId: domainJob.id };
            // Simulate a transient error while inspecting the already-returned provider output.
            if (mode === "bad-output") Object.defineProperty(receipt, "estimatedCost", { get() { throw new Error("transient"); } });
            return { ...f.input.result, receipt };
          },
        }));
        const outcome = await processAcquisitionJob({ databaseJobId: job.id, registry, runtime });
        assert.equal(outcome, mode === "cancelled" ? "cancelled" : mode === "retry-success" ? "completed" : "failed", mode);
        const blockedBeforeRun = ["missing-plan", "oversized-plan", "currency-mismatch"].includes(mode);
        assert.equal(calls, blockedBeforeRun ? 0 : mode === "retry-success" ? 2 : 1, mode);
        const count = blockedBeforeRun ? "0" : mode === "retry-success" ? "2" : "1";
        assert.equal((await inspectAcquisitionBudget(f.tenant.slug)).usage.authorizedRequests, count, mode);
        assert.equal(await processAcquisitionJob({ databaseJobId: job.id, registry, runtime }), "already-claimed");
      }
      const stale = await fixture();
      await setAcquisitionBudget(stale.tenant.slug, { ...settings, dailyRequests: 2 });
      const running = await queued(stale);
      await authorizeAcquisitionAttempt({ clientId: stale.tenant.id, jobId: running.id, attempt: 1, plan });
      await assert.rejects(authorizeAcquisitionAttempt({ clientId: stale.tenant.id, jobId: running.id, attempt: 1, plan }), /budget-attempt-already-authorized/);
      await reconcileStaleAcquisitions(new Date(Date.now() + 21 * 60_000));
      assert.equal((await inspectAcquisitionBudget(stale.tenant.slug)).usage.authorizedRequests, "1");
      const revoked = await queued(stale);
      await revokeSourceConnection({ clientId: stale.tenant.id, id: stale.source.id, now: new Date() });
      await assert.rejects(authorizeAcquisitionAttempt({ clientId: stale.tenant.id, jobId: revoked.id, attempt: 1, plan }), /cancelled|source-unavailable/);
      assert.equal((await db.select().from(acquisitionAuthorization).where(eq(acquisitionAuthorization.clientId, stale.tenant.id))).length, 1);
    });
    await t.test("revoked acquisition cleanup and dispatch are bounded, concurrent and idempotent", async () => {
      // Canonical maintenance is global, so drain abandoned work from earlier
      // scenarios before asserting the exact 201-item boundary below.
      let prior;
      do { prior = await reconcileStaleAcquisitions(new Date()); }
      while (prior.batchFull);
      const f = await fixture();
      const jobs = await db.insert(sourceAcquisitionJob).values(Array.from({ length: 201 }, () => ({
        clientId: f.tenant.id,
        sourceConnectionId: f.source.id,
        operation: f.input.operation,
        requestJson: f.input.request,
        idempotencyKey: randomUUID(),
      }))).returning({ id: sourceAcquisitionJob.id });
      const revocation = await revokeSourceConnection({ clientId: f.tenant.id, id: f.source.id, now: new Date() });
      assert.equal(revocation?.cleanupPending, true);

      let sends = 0;
      const dispatch = await dispatchQueuedAcquisitions({
        async send() { sends += 1; return "unexpected"; },
      } as unknown as Parameters<typeof dispatchQueuedAcquisitions>[0]);
      assert.deepEqual(dispatch, { attempted: 0, dispatched: 0, batchFull: false });
      assert.equal(sends, 0);

      const concurrent = await Promise.all([
        reconcileStaleAcquisitions(new Date(), { limit: 100 }),
        reconcileStaleAcquisitions(new Date(), { limit: 100 }),
      ]);
      assert.equal(concurrent.reduce((sum, item) => sum + (item.revokedCancelled ?? 0), 0), 200);
      assert.ok(concurrent.some((item) => item.batchFull));
      const final = await reconcileStaleAcquisitions(new Date(), { limit: 100 });
      assert.equal(final.revokedCancelled, 1);
      assert.equal(final.batchFull, false);
      const cancelled = await db.select().from(sourceAcquisitionJob).where(inArray(sourceAcquisitionJob.id, jobs.map((job) => job.id)));
      const receipts = await db.select().from(sourceAcquisitionReceipt).where(inArray(sourceAcquisitionReceipt.jobId, jobs.map((job) => job.id)));
      assert.equal(cancelled.length, 201);
      assert.ok(cancelled.every((job) => job.status === "cancelled"));
      assert.equal(receipts.length, 201);
      assert.ok(receipts.every((receipt) => receipt.status === "cancelled" && receipt.errorCode === "source-revoked"));
    });
    await t.test("dispatch leases split concurrent backlogs fairly and recover after expiry", async () => {
      const f = await fixture();
      const requestedAt = new Date("2000-01-01T00:00:00.000Z");
      const jobs = await db.insert(sourceAcquisitionJob).values(Array.from({ length: 201 }, (_, index) => ({
        clientId: f.tenant.id,
        sourceConnectionId: f.source.id,
        operation: f.input.operation,
        requestJson: f.input.request,
        idempotencyKey: randomUUID(),
        requestedAt: new Date(requestedAt.getTime() + index),
      }))).returning({ id: sourceAcquisitionJob.id });
      const now = Date.now();
      const dispatchedIds: number[] = [];
      const boss = {
        async send(_queue: string, payload: { databaseJobId: number }) {
          dispatchedIds.push(payload.databaseJobId);
          return randomUUID();
        },
      } as unknown as Parameters<typeof dispatchQueuedAcquisitions>[0];

      const firstTwo = await Promise.all([
        dispatchQueuedAcquisitions(boss, { clock: () => now }),
        dispatchQueuedAcquisitions(boss, { clock: () => now }),
      ]);
      assert.equal(firstTwo.reduce((sum, result) => sum + result.attempted, 0), 200);
      assert.equal(new Set(dispatchedIds).size, 200, "concurrent leases never spend attempts on the same job");
      assert.ok(dispatchedIds.every((id) => jobs.some((job) => job.id === id)));
      const last = await dispatchQueuedAcquisitions(boss, { clock: () => now });
      assert.deepEqual(last, { attempted: 1, dispatched: 1, batchFull: false });
      assert.equal(new Set(dispatchedIds).size, 201);
      await db.update(sourceAcquisitionJob).set({ status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() })
        .where(inArray(sourceAcquisitionJob.id, jobs.map((job) => job.id)));

      const leased = await db.insert(sourceAcquisitionJob).values({
        clientId: f.tenant.id,
        sourceConnectionId: f.source.id,
        operation: f.input.operation,
        requestJson: f.input.request,
        idempotencyKey: randomUUID(),
        requestedAt: new Date("1999-01-01T00:00:00.000Z"),
      }).returning({ id: sourceAcquisitionJob.id });
      const once = await dispatchQueuedAcquisitions(boss, { clock: () => now });
      assert.equal(once.attempted, 1);
      const beforeExpiry = await dispatchQueuedAcquisitions(boss, { clock: () => now + ACQUISITION_DISPATCH_LEASE_MS - 1 });
      assert.equal(beforeExpiry.attempted, 0);
      const afterExpiry = await dispatchQueuedAcquisitions(boss, { clock: () => now + ACQUISITION_DISPATCH_LEASE_MS + 1 });
      assert.equal(afterExpiry.attempted, 1);
      assert.equal(dispatchedIds.filter((id) => id === leased[0].id).length, 2);

      await db.update(sourceAcquisitionJob).set({ status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() })
        .where(eq(sourceAcquisitionJob.id, leased[0].id));
    });
    await t.test("stale acquisition reconciliation is atomic and database-timeout bounded", async () => {
      const f = await fixture();
      const job = await queued(f);
      const maintenanceNow = new Date(Date.now() + 21 * 60_000);
      const blocker = await probe.connect();
      try {
        await blocker.query("begin");
        await blocker.query("select id from source_connection where id = $1 for update", [f.source.id]);
        await assert.rejects(
          reconcileStaleAcquisitions(maintenanceNow, { deadline: new Date(Date.now() + 5_000) }),
          (error: unknown) => {
            let current: unknown = error;
            for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
              if ("code" in current && current.code === "55P03") return true;
              current = "cause" in current ? current.cause : undefined;
            }
            return false;
          },
        );
        const [unchanged] = await db.select().from(sourceAcquisitionJob).where(eq(sourceAcquisitionJob.id, job.id));
        assert.equal(unchanged.status, "running");
        assert.equal((await db.select().from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, job.id))).length, 0);
      } finally {
        await blocker.query("rollback");
        blocker.release();
      }
      const resumed = await reconcileStaleAcquisitions(maintenanceNow);
      assert.equal(resumed.staleProcessed, 1);
      const [failed] = await db.select().from(sourceAcquisitionJob).where(eq(sourceAcquisitionJob.id, job.id));
      assert.equal(failed.status, "failed");
      const [receipt] = await db.select().from(sourceAcquisitionReceipt).where(eq(sourceAcquisitionReceipt.jobId, job.id));
      assert.equal(receipt.errorCode, "worker-lease-expired");
    });
    await t.test("concurrent stale-job batches drain one over two limits without starvation", async () => {
      const first = await fixture();
      const second = await fixture();
      const startedAt = new Date("2000-01-01T00:00:00.000Z");
      const insertJobs = (f: Awaited<ReturnType<typeof fixture>>, count: number, offset: number) =>
        db.insert(sourceAcquisitionJob).values(Array.from({ length: count }, (_, index) => ({
          clientId: f.tenant.id,
          sourceConnectionId: f.source.id,
          status: "running" as const,
          operation: f.input.operation,
          requestJson: f.input.request,
          idempotencyKey: randomUUID(),
          requestedAt: new Date(startedAt.getTime() + offset + index),
          startedAt: new Date(startedAt.getTime() + offset + index),
        }))).returning({ id: sourceAcquisitionJob.id });
      const jobs = [...await insertJobs(first, 100, 0), ...await insertJobs(second, 101, 100)];

      const concurrent = await Promise.all([
        reconcileStaleAcquisitions(new Date(), { limit: 100 }),
        reconcileStaleAcquisitions(new Date(), { limit: 100 }),
      ]);
      assert.equal(concurrent.reduce((sum, result) => sum + (result.staleProcessed ?? 0), 0), 200);
      assert.ok(concurrent.some((result) => result.batchFull));
      const final = await reconcileStaleAcquisitions(new Date(), { limit: 100 });
      assert.equal(final.staleProcessed, 1);
      assert.equal(final.batchFull, false);
      const completed = await db.select().from(sourceAcquisitionJob).where(inArray(sourceAcquisitionJob.id, jobs.map((job) => job.id)));
      const receipts = await db.select().from(sourceAcquisitionReceipt).where(inArray(sourceAcquisitionReceipt.jobId, jobs.map((job) => job.id)));
      assert.equal(completed.length, 201);
      assert.ok(completed.every((job) => job.status === "failed"));
      assert.equal(receipts.length, 201);
      assert.ok(receipts.every((receipt) => receipt.errorCode === "worker-lease-expired"));
    });
    await t.test("multi-market campaigns require latest current reviews for every declared pair", async () => {
      const f = await fixture(), sw = await fixture(f.tenant), other = await fixture();
      const dk = { market: "DK", language: "da" }, se = { market: "SE", language: "sv" };
      const swPolicy = { ...policy, markets: ["SE"], languages: ["sv"] };
      await db.update(sourceConnection).set({ configurationJson: swPolicy }).where(eq(sourceConnection.id, sw.source.id));
      sw.input.applicability = { ...sw.input.applicability, markets: ["SE"], languages: ["sv"] };
      sw.input.request = { ...sw.input.request, filters: { markets: ["SE"], languages: ["sv"] } };
      sw.input.result.evidence = sw.input.result.evidence.map((item) => ({ ...item, applicability: sw.input.applicability }));
      const evidence = [await persistAcquisition(f.input), await persistAcquisition(sw.input)];
      const [user] = await db.insert(appUser).values({ name: "Synthetic scope researcher", email: "", role: "viewer", ssoSubjectId: randomUUID() }).returning();
      const scopes = [dk, se];
      const created = await createCampaignRecord({ clientId: f.tenant.id, name: "Synthetic two-market campaign", objective: "Consideration", audience: "Declared adults in each market", proposition: "Accessible quality", creativeRoutes: ["Demonstration"], channels: ["owned"], budgetAssumptions: ["Bounded pilot"], strategicEvidenceIds: evidence.flatMap((item) => item.evidenceIds), brandConstraints: ["No causal claims"], targetScopes: scopes });
      const plan = { objective: "Consideration", hypothesis: "Consideration may change", population: "Declared adults in each market", metrics: [{ key: "consideration", label: "Consideration", unit: "rate", direction: "increase" as const, aggregation: "rate" as const, population: "Declared adults in each market" }], baseline: { consideration: 0.2 }, targets: { consideration: 0.25 }, checkpoints: [new Date().toISOString()], attributionAssumptions: ["Descriptive per-market only"], materialityThresholds: { consideration: 0.02 }, decisionRules: ["Review each market separately"] };
      const scopedMeasurement = (scope: typeof dk) => {
        const population = scope.market === "SE" ? "Swedish adults" : "Danish adults";
        return { population, metrics: [{ ...plan.metrics[0], population }], baseline: { consideration: scope.market === "SE" ? 0.5 : 0.2 }, targets: { consideration: scope.market === "SE" ? 0.65 : 0.25 }, checkpoints: plan.checkpoints, attributionAssumptions: plan.attributionAssumptions, materialityThresholds: plan.materialityThresholds, decisionRules: plan.decisionRules };
      };
      const replacePlan = async () => {
        const currentScopes = (await listCampaignWorkspace(f.tenant.id))[0].payload.campaign.targetScopes!;
        const result = await createMeasurementPlanRecord({ clientId: f.tenant.id, campaignId: created.id, plan: { ...plan, targetScopes: [{ market: "US", language: "en" }], scopeMeasurements: currentScopes.map((scope) => ({ scope, measurement: scopedMeasurement(scope) })) } });
        assert.deepEqual(result.plan.targetScopes, (await listCampaignWorkspace(f.tenant.id))[0].payload.campaign.targetScopes, "server scope overrides body claims");
        await reviewMeasurementPlan({ clientId: f.tenant.id, campaignId: created.id, reviewerUserId: user.id, decision: "accepted" });
      };
      await replacePlan();
      const records: (typeof intelligenceRecord.$inferSelect)[] = [];
      for (const [index, item] of [f, sw].entries()) {
        const [record] = await db.insert(intelligenceRecord).values({ clientId: f.tenant.id, kind: "fact", title: "Reviewed market strategy", statement: "Accessible quality is the declared positioning.", lifecycle: "live", reviewState: "accepted", evidenceIds: [...evidence[index].evidenceIds], contradictionIds: [], dependencyIds: [], applicabilityJson: item.input.applicability, confidence: 0.8, uncertainty: ["Synthetic only"], synthesisBy: "human", reviewedBy: user.id, reviewedAt: new Date() }).returning();
        records.push(record);
      }
      await createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, profile: { enabledAbilities: [{ id: "campaign-preflight", version: "1.0.0" }], providerBindings: { dk: f.source.connectorId, se: sw.source.connectorId }, markets: ["DK", "SE"], languages: ["da", "sv"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } });
      const review = (index: number) => ({ pointOfView: "The proposed demonstration supports the declared positioning.", recommendation: "Submit this scope to a reviewer.", alternative: "Test an informational route.", wouldChangeConclusion: "Contradictory audience evidence would require revision.", findings: PREFLIGHT_DIMENSIONS.map((dimension) => ({ dimension, verdict: "aligned" as const, rationale: "The linked approved strategy supports this bounded proposal.", evidenceIds: evidence[index].evidenceIds.map(String), intelligenceIds: [String(records[index].id)] })) });
      const base = { clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id };
      const assess = (index: number, complete = true) => createCampaignAssessmentRecord({ ...base, stage: "preflight", ...scopes[index], preflightReview: complete ? review(index) : undefined });
      const approve = () => transitionCampaignRecord({ ...base, nextState: "approved" });
      await assert.rejects(createCampaignAssessmentRecord({ ...base, stage: "preflight", preflightReview: review(0) }), /declared campaign/);
      await assert.rejects(createCampaignAssessmentRecord({ ...base, stage: "preflight", market: "DK", language: "sv", preflightReview: review(0) }), /declared campaign/);
      const dkReady = await assess(0);
      assert.equal(dkReady.assessment.status, "ready", JSON.stringify(dkReady.assessment.researchGaps));
      assert.deepEqual(dkReady.evidenceIds, evidence[0].evidenceIds, "SE-only evidence cannot enter the DK review");
      await assert.rejects(approve(), /current-contextual-preflight-required:SE\/sv/);
      const swReady = await assess(1);
      assert.equal(swReady.assessment.status, "ready", JSON.stringify(swReady.assessment.researchGaps));
      await assess(0, false);
      await assert.rejects(approve(), /current-contextual-preflight-required:DK\/da/);
      assert.equal((await listCampaignWorkspace(f.tenant.id))[0].scopedPreflights.length, 2);
      await assess(0);
      await db.update(sourceConnection).set({ configurationJson: { ...swPolicy, permittedPurposes: ["other"] } }).where(eq(sourceConnection.id, sw.source.id));
      await assert.rejects(approve(), /campaign-context-changed/);
      await db.update(sourceConnection).set({ configurationJson: swPolicy }).where(eq(sourceConnection.id, sw.source.id));
      const scopeEdit = { ...base, expectedRevision: 1, targetScopes: [dk] };
      await assert.rejects(reviseCampaignScopes({ ...scopeEdit, clientId: other.tenant.id }), /campaign-not-found/);
      const race = await Promise.allSettled([reviseCampaignScopes(scopeEdit), reviseCampaignScopes(scopeEdit)]);
      assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(race.filter((item) => item.status === "rejected").length, 1);
      assert.equal((await assess(0)).assessment.status, "needs_context", "old shared plan no longer matches campaign scope");
      await assert.rejects(approve(), /current-contextual-preflight-required/);
      await reviseCampaignScopes({ ...base, expectedRevision: 2, targetScopes: scopes });
      await replacePlan();
      await assert.rejects(approve(), /current-contextual-preflight-required|campaign-context-changed/);
      await assess(0);
      // A review from an older revision cannot approve SE, even though the pair itself is unchanged.
      await assert.rejects(approve(), /campaign-context-changed/);
      const finalSe = await assess(1);
      if (process.env.TEST_HTTP === "1") {
        await db.insert(clientMembership).values({ clientId: f.tenant.id, userId: user.id, role: "researcher" });
        const token = await createAuthSession(user.id, f.tenant.id), server = await startTestHttpServer(url!);
        try {
          const html = await (await server.request("/campaigns", token)).text();
          assert.match(html, /Market\/language approval coverage/); assert.match(html, /SE\/sv/); assert.match(html, /DK\/da/);
          assert.equal((await server.request(`/api/campaigns/${created.id}/scope`, token, { targetScopes: scopes, expectedRevision: 1 })).status, 409);
          assert.equal((await server.request(`/api/campaigns/${created.id}/scope`, token, { targetScopes: scopes, expectedRevision: 3, clientId: other.tenant.id })).status, 400);
          assert.equal((await server.request(`/api/campaigns/${created.id}/scope`, token, { targetScopes: scopes, expectedRevision: 3 }, "https://other.invalid")).status, 403);
          assert.equal((await server.request(`/api/campaigns/${created.id}/transition`, token, { nextState: "approved" })).status, 403);
          const { runCampaignScopeBrowser } = await import("./campaign-scope-browser");
          await runCampaignScopeBrowser(server.base, token);
          const draftResponse = await server.request("/api/campaigns", token, { name: "Scoped measurement HTTP draft", objective: plan.objective, audience: "Declared adults", proposition: "Accessible quality", targetScopes: scopes });
          assert.equal(draftResponse.status, 201);
          const draft = (await draftResponse.json()).campaign;
          const { measurementConfiguration } = await import("../src/campaigns/measurementScope");
          const body = { objective: plan.objective, hypothesis: plan.hypothesis, expectedRevision: 1, expectedPlanVersion: null as number | null,
            scopeMeasurements: scopes.map((scope, index) => ({ scope, measurement: { ...measurementConfiguration(plan), population: index ? "Swedish adults" : "Danish adults", metrics: [{ ...plan.metrics[0], population: index ? "Swedish adults" : "Danish adults" }], baseline: { consideration: index ? 0.5 : 0.2 }, targets: { consideration: index ? 0.65 : 0.25 } } })) };
          const measurementPath = `/api/campaigns/${draft.id}/measurement`;
          for (const invalid of [{ ...body, scopeMeasurements: body.scopeMeasurements.slice(0, 1) }, { ...body, clientId: other.tenant.id },
            { ...body, scopeMeasurements: body.scopeMeasurements.map((item) => ({ ...item, measurement: { ...item.measurement, baseline: { consideration: null } } })) }]) assert.equal((await server.request(measurementPath, token, invalid)).status, 400);
          const planned = await server.request(measurementPath, token, body);
          assert.equal(planned.status, 201, await planned.clone().text());
          const persistedPlan = (await planned.json()).measurementPlan;
          assert.equal(persistedPlan.plan.scopeMeasurements[1].measurement.baseline.consideration, 0.5);
          assert.equal(persistedPlan.plan.scopeMeasurements[1].measurement.metrics[0].population, "Swedish adults");
          assert.equal((await server.request(measurementPath, token, body)).status, 409);
          assert.equal((await server.request(`/api/campaigns/${draft.id}/measurement/review`, token, { decision: "accepted" })).status, 403);
          const edits = await Promise.all([server.request(measurementPath, token, { ...body, expectedPlanVersion: 1 }), server.request(measurementPath, token, { ...body, expectedPlanVersion: 1 })]);
          assert.deepEqual(edits.map((item) => item.status).sort(), [201, 409]);
          const savedAudit = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.entityType, "measurement_plan")));
          assert.equal(savedAudit.filter((item) => (item.redactedAfterJson as { campaignId?: number }).campaignId === draft.id).length, 2);
          assert.equal((await server.request(`/api/campaigns/${draft.id}/scope`, token, { targetScopes: [dk], expectedRevision: 1 })).status, 200);
          assert.equal((await server.request(measurementPath, token, { ...body, expectedPlanVersion: 2 })).status, 409);
          assert.equal((await server.request(measurementPath, token, { ...body, expectedRevision: 2, expectedPlanVersion: 2 })).status, 400);
          assert.equal((await server.request(measurementPath, token, { ...body, expectedRevision: 2, expectedPlanVersion: 2, scopeMeasurements: body.scopeMeasurements.slice(0, 1) })).status, 201);
          const foreignDraft = await createCampaignRecord({ ...created.payload.campaign, clientId: other.tenant.id, targetScopes: scopes, strategicEvidenceIds: [], brandConstraints: [] });
          assert.equal((await server.request(`/api/campaigns/${foreignDraft.id}/measurement`, token, body)).status, 404);
          await db.update(clientMembership).set({ role: "reviewer" }).where(and(eq(clientMembership.clientId, f.tenant.id), eq(clientMembership.userId, user.id)));
          const reviewPath = `/api/campaigns/${draft.id}/measurement/review`;
          assert.equal((await server.request(reviewPath, token, { decision: "accepted" })).status, 400);
          assert.equal((await server.request(reviewPath, token, { decision: "accepted", expectedPlanVersion: 2 })).status, 409);
          assert.equal((await server.request(reviewPath, token, { decision: "accepted", expectedPlanVersion: 3, clientId: other.tenant.id })).status, 400);
          assert.equal((await server.request(reviewPath, token, { decision: "accepted", expectedPlanVersion: 3 }, "https://other.invalid")).status, 403);
          const reviews = await Promise.all([server.request(reviewPath, token, { decision: "accepted", expectedPlanVersion: 3 }), server.request(reviewPath, token, { decision: "rejected", expectedPlanVersion: 3 })]);
          assert.deepEqual(reviews.map((item) => item.status).sort(), [200, 409]);
          const reviewedAudit = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.entityType, "measurement_plan"), eq(governanceAudit.action, "review")));
          assert.equal(reviewedAudit.filter((item) => (item.redactedAfterJson as { campaignId?: number }).campaignId === draft.id).length, 1);
          await db.update(clientMembership).set({ role: "viewer" }).where(and(eq(clientMembership.clientId, f.tenant.id), eq(clientMembership.userId, user.id)));
          assert.equal((await server.request(measurementPath, token, { ...body, expectedRevision: 2, expectedPlanVersion: 3 })).status, 403);
          assert.equal((await server.request(`/api/campaigns/${created.id}/scope`, token, { targetScopes: scopes, expectedRevision: 3 })).status, 403);
          const view = await (await server.request("/campaigns", token)).text();
          assert.ok(!view.includes("Save declared scope"));
        } finally { await server.stop(); }
      }
      const approved = await approve();
      assert.equal(approved.payload.approvedPreflightId, undefined, "multi-market approval cannot identify a single representative review");
      assert.equal(approved.payload.approvedPreflights?.length, 2);
      assert.equal(approved.payload.approvedPreflights?.find((item) => item.market === "SE")?.artifactId, finalSe.id);
      const [audit] = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.action, "transition")));
      assert.deepEqual((audit.redactedAfterJson as { approvedPreflights: unknown }).approvedPreflights, approved.payload.approvedPreflights);
      await assert.rejects(reviseCampaignScopes({ ...base, expectedRevision: approved.currentRevision, targetScopes: [dk] }), /frozen-after-approval/);
      await transitionCampaignRecord({ ...base, nextState: "active" });
      const metricsRights = { ...rights, basis: "client_owned" as const };
      const metricSource = await createSourceConnection({ clientId: f.tenant.id, connectorId: `scoped-metrics-${randomUUID()}`, connectorVersion: "1.0.0", sourceClass: "first_party_aggregate", rights: metricsRights, policy: { ...policy, markets: ["DK", "SE"], languages: ["da", "sv"], dataClassifications: ["client-confidential"] }, retentionDays: 30, rawRetentionHours: 0 });
      await createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, profile: { enabledAbilities: [{ id: "live-campaign-intelligence", version: "1.0.0" }, { id: "post-campaign-learning", version: "1.0.0" }], providerBindings: { dk: f.source.connectorId, se: sw.source.connectorId, metrics: metricSource.connectorId }, markets: ["DK", "SE"], languages: ["da", "sv"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } });
      const selections = [];
      for (const scope of scopes) {
        const measurement = scopedMeasurement(scope), population = measurement.population;
        for (let index = 0; index < 2; index++) {
          const now = new Date().toISOString(), key = randomUUID();
          const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
          const periodStart = ago(index ? 2 : 5), periodEnd = ago(index ? 1 : 4);
          const applicability = { ...f.input.applicability, markets: [scope.market], languages: [scope.language], campaigns: [String(created.id)] };
          const method = { method: "Synthetic scoped aggregate export", universe: population, limitations: ["Synthetic descriptive data only"] };
          const request = { operation: "manual-document", filters: { markets: [scope.market], languages: [scope.language] } };
          const result = await new AggregateMetricEvidenceAdapter([{ id: key, content: `Synthetic ${scope.market} export window ${index}`, rights: metricsRights, method, applicability,
            metric: "consideration", value: measurement.baseline.consideration + (index ? 0.1 : 0), unit: "rate", cohortSize: 100, observedAt: periodEnd, dimensions: { population, aggregation: "rate", periodStart, periodEnd, campaignId: String(created.id) } }]).run({ id: key, clientId: String(f.tenant.id), sourceId: String(metricSource.id), adapterId: metricSource.connectorId, dataClassification: "client-confidential", request, idempotencyKey: key, requestedAt: now }, { now, async resolveCredential() { throw new Error("unused"); } }, { minimumCohortSize: 10, retainedEvidenceDays: 30, allowVerbatim: false, sensitiveTerms: [] });
          result.receipt.estimatedCost = 0;
          await persistAcquisition({ clientId: f.tenant.id, sourceConnectionId: metricSource.id, operation: request.operation, request, idempotencyKey: key, title: "Synthetic scoped export", rights: metricsRights, method, applicability, collectionExpiresAt: result.evidence[0].expiresAt, result });
        }
        const observations = (await db.select().from(quantitativeObservation).where(eq(quantitativeObservation.clientId, f.tenant.id)).orderBy(quantitativeObservation.observedAt)).filter((item) => (item.dimensionsJson as { population?: string }).population === population);
        const metricSelections = [{ metricKey: "consideration", baselineObservationId: String(observations[0].id), resultObservationId: String(observations[1].id) }];
        selections.push(metricSelections);
        const result = await createCampaignAssessmentRecord({ ...base, stage: "live", ...scope, metricSelections });
        assert.equal(result.assessment.status, "ready", JSON.stringify(result.assessment.researchGaps));
        const assessment = result.assessment as CampaignResultAssessment;
        assert.deepEqual(assessment.targetScope, scope);
        assert.equal(assessment.comparisons[0].population, population);
        assert.equal(assessment.comparisons[0].target, measurement.targets.consideration);
        assert.equal(assessment.comparisons[0].targetMet, scope.market === "DK");
      }
      assert.equal((await createCampaignAssessmentRecord({ ...base, stage: "live", ...se, metricSelections: selections[0] })).assessment.status, "needs_context", "Danish observations cannot stand in for Swedish results");
      if (process.env.TEST_HTTP === "1" && process.env.TEST_BROWSER_MODULE) {
        await db.update(clientMembership).set({ role: "researcher" }).where(and(eq(clientMembership.clientId, f.tenant.id), eq(clientMembership.userId, user.id)));
        const token = await createAuthSession(user.id, f.tenant.id), server = await startTestHttpServer(url!);
        try { const { runScopedResultBrowser } = await import("./campaign-scope-browser"); await runScopedResultBrowser(server.base, token); }
        finally { await server.stop(); }
      }
      await transitionCampaignRecord({ ...base, nextState: "completed" });
      const post = await createCampaignAssessmentRecord({ ...base, stage: "post", ...se, metricSelections: selections[1] });
      assert.equal(post.assessment.status, "ready");
      assert.deepEqual((post.assessment as CampaignResultAssessment).targetScope, se);
      await assert.rejects(transitionCampaignRecord({ ...base, nextState: "learning_reviewed", learningRecordId: records[0].id }), /multi-scope-learning-review-not-yet-supported/);
      assert.ok((await listCampaignWorkspace(other.tenant.id)).every((item) => item.id !== created.id));
    });

    await t.test("campaign preflight binds analyst reasoning, current Market Twin and the exact approved plan", async () => {
      const f = await fixture();
      const retained = await persistAcquisition(f.input);
      const [user] = await db.insert(appUser).values({ email: "campaign-researcher@example.invalid", name: "Synthetic campaign researcher", role: "researcher", ssoSubjectId: randomUUID() }).returning();
      const created = await createCampaignRecord({ clientId: f.tenant.id, name: "Synthetic category campaign", objective: "Increase consideration", audience: "Declared Danish audience", proposition: "Accessible quality", targetScopes: [{ market: "DK", language: "da" }],
        creativeRoutes: ["Product demonstration"], channels: ["owned"], budgetAssumptions: ["Within approved resources"], strategicEvidenceIds: retained.evidenceIds, brandConstraints: ["Descriptive claims only"] });
      const plan = { objective: "Increase consideration", hypothesis: "Consideration changes during the campaign.", population: "Eligible Danish adults",
        metrics: [{ key: "consideration", label: "Consideration", unit: "rate", direction: "increase" as const, aggregation: "rate" as const, population: "Eligible Danish adults" }],
        baseline: { consideration: 0.2 }, targets: { consideration: 0.25 }, checkpoints: ["2026-11-01T00:00:00.000Z"], attributionAssumptions: ["Descriptive only"], materialityThresholds: { consideration: 0.02 }, decisionRules: ["Validate direction before acting"] };
      await createMeasurementPlanRecord({ clientId: f.tenant.id, campaignId: created.id, plan });
      await reviewMeasurementPlan({ clientId: f.tenant.id, campaignId: created.id, reviewerUserId: user.id, decision: "accepted" });
      const [record] = await db.insert(intelligenceRecord).values({ clientId: f.tenant.id, kind: "fact", title: "Reviewed category strategy", statement: "The brand prioritizes accessible quality.", lifecycle: "live", reviewState: "accepted",
        evidenceIds: [...retained.evidenceIds], contradictionIds: [], dependencyIds: [], applicabilityJson: f.input.applicability, confidence: 0.8, uncertainty: ["Synthetic only"], synthesisBy: "human", reviewedBy: user.id, reviewedAt: new Date() }).returning();
      await createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, profile: { enabledAbilities: [{ id: "campaign-preflight", version: "1.0.0" }], providerBindings: { brand: f.source.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } });
      const review = { pointOfView: "The proposed demonstration fits the reviewed accessible-quality strategy.", recommendation: "Submit the bounded proposal to a reviewer.", alternative: "Test an informational creative route first.", wouldChangeConclusion: "Contradictory audience research would require a revised route.",
        findings: PREFLIGHT_DIMENSIONS.map((dimension) => ({ dimension, verdict: "aligned" as const, rationale: `The ${dimension} interpretation follows the cited strategy, subject to pilot validation.`, evidenceIds: retained.evidenceIds.map(String), intelligenceIds: [String(record.id)] })) };
      const request = { clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, stage: "preflight" as const, preflightReview: review };
      assert.equal((await createCampaignAssessmentRecord({ ...request, preflightReview: undefined })).assessment.status, "needs_context");
      const first = await createCampaignAssessmentRecord(request);
      assert.equal(first.assessment.status, "ready");
      assert.equal((first.assessment as ContextualPreflight).contextBasis?.intelligence[0].id, String(record.id));
      const approve = () => transitionCampaignRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, nextState: "approved" });
      // A newer incomplete assessment must not fall back to an older ready one.
      await createCampaignAssessmentRecord({ ...request, preflightReview: undefined });
      await assert.rejects(approve(), /current-contextual-preflight-required/);
      await createCampaignAssessmentRecord(request);
      // Even an accepted new measurement plan invalidates the old assessment basis.
      await createMeasurementPlanRecord({ clientId: f.tenant.id, campaignId: created.id, plan: { ...plan, targets: { consideration: 0.3 } } });
      await reviewMeasurementPlan({ clientId: f.tenant.id, campaignId: created.id, reviewerUserId: user.id, decision: "accepted" });
      await assert.rejects(approve(), /campaign-context-changed/);
      await createCampaignAssessmentRecord(request);
      const editor = await probe.connect();
      try {
        await editor.query("begin");
        await editor.query("update intelligence_record set statement = $1 where id = $2", ["A new strategic promise needs reassessment.", record.id]);
        const approval = assert.rejects(approve(), /campaign-context-changed/);
        await waitForBlocked(1);
        await editor.query("commit");
        await approval;
      } finally { await editor.query("rollback"); editor.release(); }
      assert.equal((await listCampaignWorkspace(f.tenant.id))[0].state, "proposed");
      await db.update(intelligenceRecord).set({ statement: record.statement }).where(eq(intelligenceRecord.id, record.id));
      await db.update(sourceConnection).set({ configurationJson: { ...policy, markets: ["SE"] } }).where(eq(sourceConnection.id, f.source.id));
      assert.equal((await createCampaignAssessmentRecord(request)).assessment.status, "needs_context");
      await db.update(sourceConnection).set({ configurationJson: policy }).where(eq(sourceConnection.id, f.source.id));

      if (process.env.TEST_HTTP === "1") {
        await db.insert(clientMembership).values({ clientId: f.tenant.id, userId: user.id, role: "researcher" });
        const token = await createAuthSession(user.id, f.tenant.id);
        const server = await startTestHttpServer(url!);
        try {
          const page = await server.request("/campaigns", token);
          assert.equal(page.status, 200);
          const html = await page.text();
          assert.match(html, /Analyst-authored review/);
          assert.match(html, /cultural permission/);
          const response = await server.request(`/api/campaigns/${created.id}/assessment`, token, { stage: "preflight", preflightReview: review });
          assert.equal(response.status, 201);
          assert.equal((await response.json()).artifact.assessment.status, "ready");
          assert.equal((await server.request(`/api/campaigns/${created.id}/transition`, token, { nextState: "approved" })).status, 403);
          const invalid = { ...review, findings: review.findings.map((item) => ({ ...item, intelligenceIds: ["999999999"] })) };
          const rejected = await server.request(`/api/campaigns/${created.id}/assessment`, token, { stage: "preflight", preflightReview: invalid });
          assert.equal(rejected.status, 201);
          assert.equal((await rejected.json()).artifact.assessment.status, "needs_context");
        } finally { await server.stop(); }
      }
      const final = await createCampaignAssessmentRecord(request);
      const frozen = structuredClone(final.assessment);
      assert.equal((await approve()).state, "approved");
      const workspace = (await listCampaignWorkspace(f.tenant.id))[0];
      assert.equal(workspace.payload.approvedPreflightId, final.id);
      const approvalAudit = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.action, "transition")));
      assert.equal(approvalAudit.length, 1);
      assert.equal((approvalAudit[0].redactedAfterJson as { approvedPreflightId: number }).approvedPreflightId, final.id);
      await assert.rejects(createMeasurementPlanRecord({ clientId: f.tenant.id, campaignId: created.id, plan }), /measurement-plan-frozen-after-approval/);
      await db.update(intelligenceRecord).set({ statement: "Later market knowledge does not rewrite the historical assessment." }).where(eq(intelligenceRecord.id, record.id));
      const historical = (await listCampaignWorkspace(f.tenant.id))[0].latestAssessments.preflight;
      assert.deepEqual(historical?.assessment, JSON.parse(JSON.stringify(frozen)));

      // Continue the same governed campaign using actual persisted aggregate observations.
      const metricsRights = { ...rights, basis: "client_owned" as const };
      const metricsPolicy = { ...policy, dataClassifications: ["client-confidential" as const] };
      const metricSource = await createSourceConnection({ clientId: f.tenant.id, connectorId: `metrics-${randomUUID()}`, connectorVersion: "1.0.0", sourceClass: "first_party_aggregate", rights: metricsRights, policy: metricsPolicy, retentionDays: 30, rawRetentionHours: 0 });
      await createActiveSolutionProfile({ clientId: f.tenant.id, createdBy: user.id, profile: { enabledAbilities: [{ id: "live-campaign-intelligence", version: "1.0.0" }, { id: "post-campaign-learning", version: "1.0.0" }], providerBindings: { brand: f.source.connectorId, metrics: metricSource.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } });
      await transitionCampaignRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, nextState: "active" });
      const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const windows = [[daysAgo(5), daysAgo(4)], [daysAgo(2), daysAgo(1)]];
      const metricApplicability = { ...f.input.applicability, campaigns: [String(created.id)] };
      const metricMethod = { method: "Approved aggregate survey export", universe: plan.population, limitations: ["Manually transcribed, descriptive only"] };
      const http = process.env.TEST_HTTP === "1" ? await startTestHttpServer(url!) : undefined;
      const token = http ? await createAuthSession(user.id, f.tenant.id) : undefined;
      try {
        for (let index = 0; index < 2; index++) {
          const aggregate = { metricKey: "consideration", value: index ? 0.4 : 0.2, unit: "rate", aggregation: "rate", cohortSize: 100, periodStart: windows[index][0], periodEnd: windows[index][1] };
          if (http) {
            const body = { sourceConnectionId: metricSource.id, title: "Synthetic aggregate export", content: `Synthetic export window ${index}`, method: metricMethod.method, universe: metricMethod.universe, limitations: metricMethod.limitations, ...metricApplicability, aggregate };
            const uploaded = await http.request("/api/workspace/evidence", token!, body);
            assert.equal(uploaded.status, 201, await uploaded.text());
            const replay = await http.request("/api/workspace/evidence", token!, body);
            assert.equal(replay.status, 200);
          } else {
            const now = new Date().toISOString(), key = randomUUID();
            const request = { operation: "manual-document", filters: { markets: ["DK"], languages: ["da"] } };
            const result = await new AggregateMetricEvidenceAdapter([{ id: key, content: `Synthetic export window ${index}`, rights: metricsRights, method: metricMethod, applicability: metricApplicability,
              metric: aggregate.metricKey, value: aggregate.value, unit: aggregate.unit, cohortSize: aggregate.cohortSize, observedAt: aggregate.periodEnd, dimensions: { population: plan.population, aggregation: aggregate.aggregation, periodStart: aggregate.periodStart, periodEnd: aggregate.periodEnd, campaignId: String(created.id) } }]).run({ id: key, clientId: String(f.tenant.id), sourceId: String(metricSource.id), adapterId: metricSource.connectorId, dataClassification: "client-confidential", request, idempotencyKey: key, requestedAt: now }, { now, async resolveCredential() { throw new Error("unused"); } }, { minimumCohortSize: 10, retainedEvidenceDays: 30, allowVerbatim: false, sensitiveTerms: [] });
            result.receipt.estimatedCost = 0;
            await persistAcquisition({ clientId: f.tenant.id, sourceConnectionId: metricSource.id, operation: request.operation, request, idempotencyKey: key, title: "Synthetic aggregate export", rights: metricsRights, method: metricMethod, applicability: metricApplicability, collectionExpiresAt: result.evidence[0].expiresAt, result });
          }
        }
        const observations = await db.select().from(quantitativeObservation).where(eq(quantitativeObservation.clientId, f.tenant.id)).orderBy(quantitativeObservation.observedAt);
        assert.equal(observations.length, 2, "replays do not duplicate observation rows");
        const metricSelections = [{ metricKey: "consideration", baselineObservationId: String(observations[0].id), resultObservationId: String(observations[1].id) }];
        const assess = () => createCampaignAssessmentRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, stage: "live", metricSelections });
        const live = await assess();
        assert.equal(live.assessment.status, "ready", JSON.stringify(live.assessment.researchGaps));
        assert.ok(Math.abs((live.assessment as CampaignResultAssessment).comparisons[0].result! - 0.4) < 1e-6);
        assert.ok((live.assessment as CampaignResultAssessment).contextBasis?.intelligence.length);
        if (http) {
          const page = await http.request("/campaigns", token!);
          assert.equal(page.status, 200);
          assert.match(await page.text(), /Select imported aggregate observations/);
          const manual = await http.request(`/api/campaigns/${created.id}/assessment`, token!, { stage: "live", current: { consideration: 999 }, baseline: { consideration: 0.2 } });
          assert.equal(manual.status, 400);
          const reconciled = await http.request(`/api/campaigns/${created.id}/assessment`, token!, { stage: "live", metricSelections });
          assert.equal(reconciled.status, 201); assert.equal((await reconciled.json()).artifact.assessment.status, "ready");
        }
        await db.update(quantitativeObservation).set({ unit: "percent" }).where(eq(quantitativeObservation.id, observations[1].id));
        assert.equal((await assess()).assessment.status, "needs_context");
        await db.update(quantitativeObservation).set({ unit: "rate" }).where(eq(quantitativeObservation.id, observations[1].id));
        await transitionCampaignRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, nextState: "completed" });
        const post = await createCampaignAssessmentRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, stage: "post", metricSelections });
        assert.equal(post.assessment.status, "ready"); assert.equal(post.assessment.candidateLearning, undefined);
        const createLearning = (assessmentId: number) => createCampaignLearningCandidate({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, assessmentId, now: new Date() });
        await assert.rejects(createLearning(post.id), /current-interpreted-post-assessment-required/);
        const interpretation = { observation: "Consideration changed across the declared windows.", hypothesis: "Distribution changes could be an alternative explanation.", insight: "The direction is consistent with the strategy, but needs controlled follow-up.", recommendation: "Commission a bounded follow-up test.", clientRelevance: "Consideration is the approved strategic metric.", alternativeExplanations: "Seasonality and distribution were not controlled.", wouldChangeConclusion: "A corrected baseline or independent contradictory evidence.", conditions: "Only this campaign, population, period and method.", learningStatement: "The observed direction supports further study of accessible-quality positioning, with attribution unresolved.", confidence: 0.55, evidenceIds: observations.map((item) => String(item.evidenceId)), intelligenceIds: [String(record.id)], metricKeys: ["consideration"] };
        const interpretedRequest = { clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, stage: "post" as const, metricSelections, interpretation };
        const interpreted = await createCampaignAssessmentRecord(interpretedRequest);
        assert.equal(interpreted.assessment.status, "ready");
        const [firstCandidate, replayedCandidate] = await Promise.all([createLearning(interpreted.id), createLearning(interpreted.id)]);
        assert.equal(firstCandidate.id, replayedCandidate.id);
        assert.equal(firstCandidate.confidence.toFixed(2), "0.55");
        assert.deepEqual(firstCandidate.applicability.markets, ["DK"]);
        assert.equal(await reviewIntelligenceRecord({ clientId: f.tenant.id, id: Number(firstCandidate.id), reviewerUserId: user.id, decision: "accepted", now: new Date() }), null, "generic acceptance cannot bypass campaign learning checks");
        const promote = (sourceId: string) => promoteCampaignLearning({ clientId: f.tenant.id, sourceId: Number(sourceId), reviewerUserId: user.id, now: new Date() });
        const originalStrategy = (await db.select().from(intelligenceRecord).where(eq(intelligenceRecord.id, record.id)))[0].statement;
        const editor = await probe.connect();
        try {
          await editor.query("begin");
          await editor.query("update intelligence_record set statement = $1 where id = $2", ["Concurrent strategy change must invalidate promotion.", record.id]);
          const promotion = assert.rejects(promote(firstCandidate.id), /campaign-learning-context-changed/);
          await waitForBlocked(1); await editor.query("commit"); await promotion;
        } finally { await editor.query("rollback"); editor.release(); }
        await db.update(intelligenceRecord).set({ statement: originalStrategy }).where(eq(intelligenceRecord.id, record.id));
        await createCampaignAssessmentRecord({ ...interpretedRequest, interpretation: undefined });
        await assert.rejects(promote(firstCandidate.id), /current-interpreted-post-assessment-required/);
        const licenceExpiry = new Date(Date.now() + 2 * 86400000);
        await db.update(sourceConnection).set({ rightsJson: { ...metricsRights, expiresAt: licenceExpiry.toISOString() } }).where(eq(sourceConnection.id, metricSource.id));
        let latestInterpretation: Awaited<ReturnType<typeof createCampaignAssessmentRecord>>;
        if (http) {
          const response = await http.request(`/api/campaigns/${created.id}/assessment`, token!, { stage: "post", metricSelections, interpretation });
          assert.equal(response.status, 201); latestInterpretation = (await response.json()).artifact;
          const rendered = await http.request("/campaigns", token!);
          assert.equal(rendered.status, 200); assert.match(await rendered.text(), /Analyst-authored interpretation/);
        } else latestInterpretation = await createCampaignAssessmentRecord(interpretedRequest);
        const candidate = await createLearning(latestInterpretation.id);
        await db.update(intelligenceRecord).set({ statement: "A modified candidate was not assessed." }).where(eq(intelligenceRecord.id, Number(candidate.id)));
        await assert.rejects(promote(candidate.id), /learning-candidate-changed-or-unavailable/);
        await db.update(intelligenceRecord).set({ statement: candidate.statement }).where(eq(intelligenceRecord.id, Number(candidate.id)));
        await assert.rejects(promoteCampaignLearning({ clientId: f.tenant.id, sourceId: Number(candidate.id), reviewerUserId: user.id, now: new Date(), decayAt: new Date(Date.now() - 1000) }), /learning-decay/);
        if (http) {
          const replay = await http.request(`/api/campaigns/${created.id}/learning`, token!, { assessmentId: latestInterpretation.id });
          assert.equal(replay.status, 201); assert.equal((await replay.json()).record.id, candidate.id);
          assert.equal((await http.request(`/api/workspace/intelligence/${candidate.id}/promote`, token!, {})).status, 403);
          const [reviewer] = await db.insert(appUser).values({ email: "campaign-reviewer@example.invalid", name: "Synthetic reviewer", role: "reviewer", ssoSubjectId: randomUUID() }).returning();
          await db.insert(clientMembership).values({ clientId: f.tenant.id, userId: reviewer.id, role: "reviewer" });
          const reviewerToken = await createAuthSession(reviewer.id, f.tenant.id);
          const responses = await Promise.all([http.request(`/api/workspace/intelligence/${candidate.id}/promote`, reviewerToken, {}), http.request(`/api/workspace/intelligence/${candidate.id}/promote`, reviewerToken, {})]);
          for (const response of responses) assert.equal(response.status, 201);
          const promoted = await Promise.all(responses.map((response) => response.json()));
          assert.equal(promoted[0].record.id, promoted[1].record.id);
        } else {
          const promoted = await Promise.all([promote(candidate.id), promote(candidate.id)]);
          assert.equal(promoted[0].id, promoted[1].id);
        }
        const learnings = await db.select().from(intelligenceRecord).where(and(eq(intelligenceRecord.clientId, f.tenant.id), eq(intelligenceRecord.kind, "learning")));
        assert.equal(learnings.length, 1); assert.ok(learnings[0].decayAt);
        assert.ok(learnings[0].decayAt! <= licenceExpiry, "learning cannot outlive current source licensing");
        const audits = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.action, "promote")));
        assert.equal(audits.length, 1, "concurrent promotion is idempotent with one atomic audit");
        const finishLearning = () => transitionCampaignRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, nextState: "learning_reviewed", learningRecordId: learnings[0].id });
        const [unexpired] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, observations[1].evidenceId));
        await db.update(canonicalEvidence).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(canonicalEvidence.id, observations[1].evidenceId));
        await assert.rejects(finishLearning(), /current-campaign-learning-evidence-required/);
        await db.update(canonicalEvidence).set({ expiresAt: unexpired.expiresAt }).where(eq(canonicalEvidence.id, observations[1].evidenceId));
        assert.equal((await finishLearning()).state, "learning_reviewed");
        assert.equal((await listCampaignWorkspace(f.tenant.id))[0].payload.reviewedLearningId, learnings[0].id);
        await db.update(canonicalEvidence).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(canonicalEvidence.id, observations[1].evidenceId));
        const projected = (await listCampaignWorkspace(f.tenant.id))[0].latestAssessments.post!;
        assert.equal(projected.basisStatus, "stale");
        assert.equal(projected.quarantined, true);
        assert.equal(projected.assessment.status, "needs_context");
        assert.equal("comparisons" in projected.assessment, false, "read-time projection withholds copied results before the worker runs");
        await enforceCanonicalRetention(new Date(), f.tenant.id);
        const [redacted] = await db.select().from(researchArtifact).where(eq(researchArtifact.id, post.id));
        const comparison = (redacted.payloadJson as { assessment: CampaignResultAssessment }).assessment.comparisons[0];
        assert.equal(comparison.expired, true); assert.equal(comparison.result, undefined); assert.equal(comparison.delta, undefined);
        await assert.rejects(createCampaignAssessmentRecord({ clientId: f.tenant.id, campaignId: created.id, actorUserId: user.id, stage: "post", metricSelections }), /campaign-state-incompatible-with-assessment/);
      } finally { await http?.stop(); }
    });
  } finally {
    await probe.end();
    await (globalThis as unknown as { pgPool: Pool }).pgPool.end();
  }
});
