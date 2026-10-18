import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { appUser, authSession, client, clientMembership, governanceAudit, intelligenceRecord, sourceConnection } from "../src/db/schema";
import { sessionTokenHash } from "../src/lib/authTokens";
import { startTestHttpServer } from "./http-server";

type Fixture = { tenant: { id: number; slug: string }; source: { id: number; connectorId: string }; input: Parameters<typeof import("../src/db/queries/canonical_evidence").persistAcquisition>[0] };
export async function runCompanyContextCases(t: TestContext, db: typeof import("../src/db/client").db, probe: Pool, fixtures: () => Promise<{ first: Fixture; second: Fixture }>) {
  const { createAuthSession } = await import("../src/db/queries/auth_sessions");
  const { saveCompanyContext, getCompanyContext, listCompanyContextHistory, companyContextEnvelope } = await import("../src/db/queries/company_context");
  const content = { name: "Synthetic company", offer: "Consulting", audiences: "Marketing leaders", valueProposition: "Human-led change", positioning: "Creative AI", priorities: "Positioning", constraints: "Denmark first", markets: ["DK"], languages: ["da"], sourceBindings: [] };
  const edit = (expectedVersion: number | null = null) => ({ expectedVersion, content, reviewAfter: new Date(Date.now() + 30 * 86400000).toISOString(), changeReason: "Synthetic owner declaration" });
  async function actor(role = "admin", clientId?: number) {
    clientId ??= (await db.insert(client).values({ name: "Synthetic company context", slug: `company-${randomUUID()}` }).returning())[0].id;
    const [user] = await db.insert(appUser).values({ ssoSubjectId: randomUUID(), name: "Synthetic owner", email: "", role: "viewer" }).returning();
    await db.insert(clientMembership).values({ clientId, userId: user.id, role });
    const token = await createAuthSession(user.id, clientId);
    return { clientId, user, token, authority: { clientId, actorUserId: user.id, sessionHash: sessionTokenHash(token)! } };
  }
  async function blocked(count = 1) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await probe.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0");
      if (result.rows[0].n >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Expected blocked company context operation");
  }
  await t.test("company revisions are tenant-scoped, append-only, optimistic and audited without profile copies", async () => {
    const a = await actor(); const foreign = await actor("owner");
    assert.equal((await companyContextEnvelope(a.clientId)).status, "needs_context");
    await assert.rejects(saveCompanyContext({ ...a.authority, clientId: foreign.clientId }, edit()), /permission-denied/);
    for (const role of ["viewer", "researcher", "reviewer"]) await assert.rejects(saveCompanyContext((await actor(role, a.clientId)).authority, edit()), /permission-denied/);
    const race = await Promise.allSettled([saveCompanyContext(a.authority, edit()), saveCompanyContext(a.authority, edit())]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.match(String((race.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /version-conflict/);
    await saveCompanyContext(a.authority, { ...edit(1), content: { ...content, positioning: "Revised positioning" } });
    const history = await listCompanyContextHistory(a.clientId);
    assert.deepEqual(history.map((row) => row.version), [2, 1]);
    assert.equal(history[1].content.positioning, "Creative AI");
    assert.equal((await getCompanyContext(foreign.clientId)), null);
    assert.equal((await companyContextEnvelope(a.clientId)).status, "available");
    for (const reviewAfter of [new Date(0).toISOString(), new Date(Date.now() + 367 * 86400000).toISOString()]) await assert.rejects(saveCompanyContext(a.authority, { ...edit(2), reviewAfter }), /review-date-invalid/);
    const { first } = await fixtures();
    await assert.rejects(saveCompanyContext(a.authority, { ...edit(2), content: { ...content, sourceBindings: [{ purpose: "crm_aggregate", sourceConnectionId: first.source.id }] } }), /source-invalid/);
    const same = await actor("owner", first.tenant.id);
    await assert.rejects(saveCompanyContext(same.authority, { ...edit(), content: { ...content, sourceBindings: [{ purpose: "strategy", sourceConnectionId: first.source.id }] } }), /source-invalid/);
    await db.update(sourceConnection).set({ sourceClass: "first_party_aggregate" }).where(eq(sourceConnection.id, first.source.id));
    await saveCompanyContext(same.authority, { ...edit(), content: { ...content, sourceBindings: [{ purpose: "sales_aggregate", sourceConnectionId: first.source.id }] } });
    const audit = await db.select().from(governanceAudit).where(eq(governanceAudit.clientId, a.clientId));
    assert.equal(audit.length, 2); assert.equal(audit[0].actorUserId, a.user.id);
    for (const privateValue of [a.token, a.authority.sessionHash, content.valueProposition]) assert.equal(JSON.stringify(audit).includes(privateValue), false);
  });

  await t.test("company authority is rechecked after locks and expiry rolls back the revision and audit", async () => {
    const a = await actor(); const barrier = await probe.connect();
    try {
      await barrier.query("begin"); await barrier.query("select pg_advisory_xact_lock(73009, $1)", [a.clientId]);
      const denied = assert.rejects(saveCompanyContext(a.authority, edit()), /permission-denied/); await blocked();
      await db.update(clientMembership).set({ role: "viewer" }).where(and(eq(clientMembership.clientId, a.clientId), eq(clientMembership.userId, a.user.id)));
      await barrier.query("commit"); await denied;
      assert.equal(await getCompanyContext(a.clientId), null);
      await db.update(clientMembership).set({ role: "admin" }).where(and(eq(clientMembership.clientId, a.clientId), eq(clientMembership.userId, a.user.id)));
      await db.update(authSession).set({ expiresAt: sql`clock_timestamp() + interval '1500 milliseconds'` }).where(eq(authSession.tokenHash, a.authority.sessionHash));
      await barrier.query("begin"); await barrier.query("lock table governance_audit in access exclusive mode");
      const expired = assert.rejects(saveCompanyContext(a.authority, edit()), /permission-denied/); await blocked();
      await new Promise((resolve) => setTimeout(resolve, 1_600));
      await barrier.query("commit"); await expired;
      assert.equal(await getCompanyContext(a.clientId), null);
      assert.equal((await db.select().from(governanceAudit).where(eq(governanceAudit.clientId, a.clientId))).length, 0);
      await db.update(authSession).set({ expiresAt: sql`clock_timestamp() + interval '1 day'` }).where(eq(authSession.tokenHash, a.authority.sessionHash));
      await barrier.query("begin"); await barrier.query("lock table governance_audit in access exclusive mode");
      const reviewDeadline = Date.now() + 1_500;
      const overdue = assert.rejects(saveCompanyContext(a.authority, { ...edit(), reviewAfter: new Date(reviewDeadline).toISOString() }), /review-date-invalid/); await blocked();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, reviewDeadline - Date.now()) + 100));
      await barrier.query("commit"); await overdue;
      assert.equal(await getCompanyContext(a.clientId), null);
      assert.equal((await db.select().from(governanceAudit).where(eq(governanceAudit.clientId, a.clientId))).length, 0);
    } finally { await barrier.query("rollback"); barrier.release(); }
  });

  await t.test("research freezes company revision and concurrent first declaration invalidates an older basis", async () => {
    const { first, second } = await fixtures(); const a = await actor("owner", first.tenant.id);
    const { persistAcquisition } = await import("../src/db/queries/canonical_evidence");
    const { createActiveSolutionProfile } = await import("../src/db/queries/solution_profiles");
    const { loadResearchContextSources } = await import("../src/db/queries/research_context");
    const { runContextualResearch } = await import("../src/abilities/synthesis");
    const { saveDecisionBrief } = await import("../src/db/queries/workspace_intelligence");
    const one = await persistAcquisition(first.input); const two = await persistAcquisition(second.input);
    const evidenceIds = [...one.evidenceIds, ...two.evidenceIds].map(String);
    await db.insert(intelligenceRecord).values({ clientId: a.clientId, kind: "fact", title: "Reviewed context", statement: "Prioritize a bounded study.", lifecycle: "live", reviewState: "accepted", evidenceIds: [...one.evidenceIds], contradictionIds: [], dependencyIds: [], applicabilityJson: first.input.applicability, confidence: 0.8, uncertainty: ["Synthetic only"], synthesisBy: "human", reviewedBy: a.user.id, reviewedAt: new Date() });
    await createActiveSolutionProfile({ clientId: a.clientId, createdBy: a.user.id, profile: { enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }], providerBindings: { first: first.source.connectorId, second: second.source.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } });
    const generate = async () => runContextualResearch({ clientId: String(a.clientId), abilityId: "market-category-diagnosis", question: "Which research next?", market: "DK", language: "da", now: new Date().toISOString(), sources: await loadResearchContextSources({ clientId: a.clientId }), analysis: { pointOfView: "The category merits research.", clientRelevance: "Supports the decision.", recommendation: "Validate independently.", nextDecision: "Choose the study.", claimMode: "descriptive", evidenceIds, contradictions: [], uncertainty: ["Synthetic descriptive evidence only"] } });
    const old = await generate(); assert.equal(old.status, "ready");
    const barrier = await probe.connect();
    try {
      await barrier.query("begin"); await barrier.query("select pg_advisory_xact_lock(73009, $1)", [a.clientId]);
      const publishing = saveCompanyContext(a.authority, edit()); await blocked();
      const rejected = assert.rejects(saveDecisionBrief({ clientId: a.clientId, createdBy: a.user.id, brief: old }), /research-context-changed/); await blocked(2);
      await barrier.query("commit"); await publishing; await rejected;
    } finally { await barrier.query("rollback"); barrier.release(); }
    const current = await generate(); assert.equal(current.status, "ready"); assert.equal(current.contextBasis?.companyContextVersion, 1);
    const saved = await saveDecisionBrief({ clientId: a.clientId, createdBy: a.user.id, brief: current });
    await saveCompanyContext(a.authority, { ...edit(1), content: { ...content, priorities: "Competition" } });
    await assert.rejects(saveDecisionBrief({ clientId: a.clientId, createdBy: a.user.id, brief: { ...current, id: randomUUID() } }), /research-context-changed/);
    assert.equal(saved.brief.contextBasis?.companyContextVersion, 1);
    assert.equal((await generate()).contextBasis?.companyContextVersion, 2);
  });

  if (process.env.TEST_HTTP === "1") await t.test("company HTTP and browser enforce tenant, roles, origin, persistence and stale-editor conflicts", async () => {
    const a = await actor(); const other = await actor(); const viewer = await actor("viewer", a.clientId);
    const server = await startTestHttpServer(process.env.TEST_DATABASE_URL!);
    try {
      assert.equal((await server.request("/api/company-context")).status, 401);
      assert.equal((await server.request("/api/company-context", a.token, edit(), "https://foreign.invalid")).status, 403);
      for (const role of ["viewer", "researcher", "reviewer"]) {
        const denied = await actor(role, a.clientId);
        assert.equal((await server.request("/api/company-context", denied.token, edit())).status, 403);
        assert.equal((await server.request("/api/company-context", denied.token)).status, 200);
      }
      assert.equal((await server.request(`/api/company-context?clientId=${other.clientId}`, a.token)).status, 400);
      assert.equal((await server.request("/api/company-context", a.token, { ...edit(), clientId: other.clientId })).status, 400);
      const created = await server.request("/api/company-context", a.token, edit());
      assert.equal(created.status, 201); assert.match(created.headers.get("cache-control") ?? "", /no-store/);
      assert.equal((await server.request("/api/company-context", a.token, edit())).status, 409);
      assert.equal((await (await server.request("/api/company-context", other.token)).json()).current, null);
      const readable = await server.request("/api/company-context", viewer.token);
      assert.match(readable.headers.get("cache-control") ?? "", /no-store/); assert.equal((await readable.json()).current.version, 1);
      const html = await (await server.request("/company", viewer.token)).text();
      assert.ok(html.includes("Synthetic company")); assert.ok(!html.includes("Save company profile version"));
      if (process.env.TEST_BROWSER_MODULE) {
        const { runCompanyBrowserCase } = await import("./company-browser");
        await runCompanyBrowserCase(server.base, a.token);
      }
    } finally { await server.stop(); }
  });
}
