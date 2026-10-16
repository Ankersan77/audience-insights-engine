import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { appUser, authSession, client, clientMembership, canonicalEvidence, researchProject, intelligenceRecord, monitoringRun, solutionProfile, sourceConnection, sourceAcquisitionJob, sourceAcquisitionReceipt, governanceAudit } from "../src/db/schema";
import { PublicWebEvidenceAdapter } from "../src/evidence/adapters";
import type { SourceConnectionPolicy } from "../src/core/contracts";
import { dueBriefingWindows } from "../src/monitoring/briefings";
import { startTestHttpServer } from "./http-server";
import { newSessionToken, sessionTokenHash, SESSION_MAX_AGE_SECONDS } from "../src/lib/authTokens";

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
const { createActiveSensingProfile } = await import("../src/db/queries/monitoring");
const { generateDueBriefings, listPeriodicBriefings, reviewPeriodicBriefing } = await import("../src/db/queries/briefings");
const { createAuthSession, resolveAuthSession, revokeAuthSession, purgeAuthSessions, resolveProvisionedIdentity } = await import("../src/db/queries/auth_sessions");
const { setClientAccess } = await import("../src/db/queries/client_access");
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

      // Opt-in HTTP proof uses real opaque sessions against the isolated test database.
      if (process.env.TEST_HTTP === "1") {
        const server = await startTestHttpServer(url!);
        try {
          await db.insert(clientMembership).values([{ userId: user.id, clientId: f.tenant.id, role: "reviewer" }, { userId: user.id, clientId: other.tenant.id, role: "reviewer" }]);
          const session = await createAuthSession(user.id, f.tenant.id);
          assert.equal((await server.request("/api/monitoring/briefings")).status, 401);
          const viewerIdentity = await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject: randomUUID(), role: "viewer" });
          const viewer = await createAuthSession(viewerIdentity.userId!, f.tenant.id);
          assert.equal((await server.request(`/api/monitoring/briefings/${packet.id}/review`, viewer, { decision: "accepted" })).status, 403);
          assert.equal((await server.request("/api/monitoring/briefings/settings", session, { profileId: configured.databaseId, cadences: [] })).status, 403);
          const otherSession = await createAuthSession(user.id, other.tenant.id);
          assert.equal((await server.request(`/api/monitoring/briefings/${packet.id}/review`, otherSession, { decision: "accepted" })).status, 404);
          const listing = await server.request("/api/monitoring/briefings", viewer);
          assert.equal(listing.status, 200);
          assert.equal((await listing.json()).briefings.length, 1);
          const page = await server.request("/monitoring", viewer);
          assert.equal(page.status, 200);
          const html = await page.text();
          assert.ok(html.includes("Scheduled research reviews"));
          assert.ok(!html.includes("Save briefing rhythms"));
          assert.ok(!html.includes("Accept review packet"));
          assert.equal((await server.request(`/api/monitoring/briefings/${packet.id}/review`, session, { decision: "accepted" })).status, 200);
          assert.equal((await server.request(`/api/monitoring/briefings/${packet.id}/review`, session, { decision: "rejected" })).status, 404);
        } finally { await server.stop(); }
      } else {
        const reviews = await Promise.all([reviewPeriodicBriefing(reviewInput), reviewPeriodicBriefing(reviewInput)]);
        assert.equal(reviews.filter(Boolean).length, 1);
      }
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
          for (const invalid of [expired, future, token, newSessionToken(), "legacy.signed.payload", active + ".extra"]) assert.equal((await server.request("/api/monitoring/briefings", invalid)).status, 401);
          assert.equal((await server.request("/api/monitoring/briefings", active)).status, 200);
          assert.equal((await server.request("/api/monitoring/briefings/999999999/review", active, { decision: "accepted" })).status, 404);
          await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "viewer" });
          assert.equal((await server.request("/api/monitoring/briefings/999999999/review", active, { decision: "accepted" })).status, 403);
          for (const origin of [null, "https://foreign.example", "null"]) assert.equal((await server.request("/api/auth/logout", active, {}, origin)).status, 403);
          assert.equal((await server.request("/api/auth/logout", active)).status, 405);
          assert.equal((await server.request("/api/monitoring/briefings", active)).status, 200);
          const logout = await server.request("/api/auth/logout", active, {});
          assert.equal(logout.status, 303);
          assert.match(logout.headers.get("set-cookie") ?? "", /market_research_session=;/);
          assert.equal((await server.request("/api/monitoring/briefings", active)).status, 401);
          const revoked = await createAuthSession(userId, f.tenant.id);
          await setClientAccess({ action: "revoke", clientSlug: f.tenant.slug, subject });
          assert.equal((await server.request("/api/monitoring/briefings", revoked)).status, 401);
          await setClientAccess({ action: "grant", clientSlug: f.tenant.slug, subject, role: "reviewer" });
          assert.equal((await server.request("/api/monitoring/briefings", revoked)).status, 401);
          assert.equal((await server.request("/api/auth/callback?code=synthetic-invalid-code")).status, 403);
        } finally { await server.stop(); }
      } else {
        await revokeAuthSession(active);
        assert.equal(await resolveAuthSession(active), null);
      }
      await purgeAuthSessions(new Date(Date.now() + (SESSION_MAX_AGE_SECONDS + 120) * 1000));
      assert.equal((await db.select().from(authSession).where(eq(authSession.userId, userId))).length, 0);
    });
  } finally {
    await probe.end();
    await (globalThis as unknown as { pgPool: Pool }).pgPool.end();
  }
});
