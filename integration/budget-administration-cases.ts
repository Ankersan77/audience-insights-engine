import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { appUser, authSession, client, clientMembership, governanceAudit } from "../src/db/schema";
import { sessionTokenHash } from "../src/lib/authTokens";
import { startTestHttpServer } from "./http-server";

export async function runBudgetAdministrationCases(t: TestContext, db: typeof import("../src/db/client").db, probe: Pool) {
  const { createAuthSession } = await import("../src/db/queries/auth_sessions");
  const { setAcquisitionBudget, inspectAcquisitionBudget } = await import("../src/db/queries/acquisition_budget");
  const { setSynthesisBudget, inspectSynthesisBudget } = await import("../src/db/queries/synthesis_budget");
  const { loadBudgetWorkspace } = await import("../src/db/queries/budget_workspace");
  const policy = { currency: "DKK", dailyCostMicros: 0, dailyRequests: 5, enabled: false };
  async function fixture(role = "admin", existing?: typeof client.$inferSelect) {
    const tenant = existing ?? (await db.insert(client).values({ name: "Synthetic budget workspace", slug: `budget-ui-${randomUUID()}` }).returning())[0];
    const [user] = await db.insert(appUser).values({ ssoSubjectId: randomUUID(), name: "Synthetic budget operator", email: "", role: "viewer" }).returning();
    await db.insert(clientMembership).values({ clientId: tenant.id, userId: user.id, role });
    const token = await createAuthSession(user.id, tenant.id);
    return { tenant, user, token, authority: { clientId: tenant.id, actorUserId: user.id, sessionHash: sessionTokenHash(token)!, expectedVersion: null as number | null } };
  }
  async function blocked() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await probe.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0");
      if (result.rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Expected a blocked budget edit");
  }

  for (const kind of ["acquisition", "synthesis"] as const) {
    const update = async (f: Awaited<ReturnType<typeof fixture>>, authority = f.authority) => kind === "acquisition"
      ? setAcquisitionBudget(f.tenant.slug, { ...policy, dailyRecords: 10 }, authority)
      : setSynthesisBudget(f.tenant.slug, policy, authority);
    const inspect = kind === "acquisition" ? inspectAcquisitionBudget : inspectSynthesisBudget;
    const lockId = kind === "acquisition" ? 73007 : 73008;
    await t.test(`${kind} administration checks live authority, prevents lost edits and attributes atomic audits`, async () => {
      const f = await fixture(); const foreign = await fixture("owner");
      await assert.rejects(update(f, foreign.authority), /permission-denied/);
      for (const role of ["viewer", "researcher", "reviewer"]) {
        const denied = await fixture(role, f.tenant);
        await assert.rejects(update(denied), /permission-denied/);
      }
      const raced = await Promise.allSettled([update(f), update(f)]);
      assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
      assert.match(String((raced.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /version-conflict/);
      assert.equal((await inspect(f.tenant.slug)).policy?.version, 1);
      const entries = await db.select().from(governanceAudit).where(and(eq(governanceAudit.clientId, f.tenant.id), eq(governanceAudit.action, `admin_set_${kind}_budget`)));
      assert.equal(entries.length, 1); assert.equal(entries[0].actorUserId, f.user.id);
      assert.equal(JSON.stringify(entries).includes(f.authority.sessionHash), false);
      assert.equal(JSON.stringify(entries).includes(f.token), false);
      f.authority.expectedVersion = 1;
      // An operator edit also invalidates stale browser versions, without creating a public bypass.
      if (kind === "acquisition") await setAcquisitionBudget(f.tenant.slug, { ...policy, dailyRecords: 10 });
      else await setSynthesisBudget(f.tenant.slug, policy);
      await assert.rejects(update(f), /version-conflict/);
      f.authority.expectedVersion = 2;
      await db.update(authSession).set({ revokedAt: new Date() }).where(eq(authSession.tokenHash, f.authority.sessionHash));
      await assert.rejects(update(f), /permission-denied/);
      assert.equal((await inspect(f.tenant.slug)).policy?.version, 2);
      await update(foreign); // owner is allowed, but only in their own tenant.
      assert.equal((await inspect(foreign.tenant.slug)).policy?.version, 1);
    });

    await t.test(`${kind} edits reject revocation ahead of the budget lock and session expiry during audit contention`, async () => {
      const f = await fixture(); const barrier = await probe.connect();
      try {
        await barrier.query("begin"); await barrier.query("select pg_advisory_xact_lock($1, $2)", [lockId, f.tenant.id]);
        const denied = assert.rejects(update(f), /permission-denied/); await blocked();
        await db.update(clientMembership).set({ role: "viewer" }).where(and(eq(clientMembership.clientId, f.tenant.id), eq(clientMembership.userId, f.user.id)));
        await barrier.query("commit"); await denied;
        assert.equal((await inspect(f.tenant.slug)).policy, null);
        await db.update(clientMembership).set({ role: "admin" }).where(and(eq(clientMembership.clientId, f.tenant.id), eq(clientMembership.userId, f.user.id)));
        await db.update(authSession).set({ expiresAt: sql`clock_timestamp() + interval '500 milliseconds'` }).where(eq(authSession.tokenHash, f.authority.sessionHash));
        await barrier.query("begin"); await barrier.query("lock table governance_audit in access exclusive mode");
        const expired = assert.rejects(update(f), /permission-denied/); await blocked();
        await new Promise((resolve) => setTimeout(resolve, 550));
        await barrier.query("commit"); await expired;
        assert.equal((await inspect(f.tenant.slug)).policy, null);
        const entries = await db.select().from(governanceAudit).where(eq(governanceAudit.clientId, f.tenant.id));
        assert.equal(entries.length, 0);
      } finally { await barrier.query("rollback"); barrier.release(); }
    });
  }

  await t.test("budget workspace projects only limits, reserved usage and recovery state", async () => {
    const f = await fixture(); const view = await loadBudgetWorkspace(f.tenant.id);
    assert.equal(view.budgets.length, 2); assert.ok(view.budgets.every((item) => item.policy === null));
    const json = JSON.stringify(view);
    for (const forbidden of ["clientId", "actorUserId", "credential", "sessionHash", f.token, f.tenant.slug]) assert.equal(json.includes(forbidden), false);
    await db.update(client).set({ slug: `renamed-${randomUUID()}` }).where(eq(client.id, f.tenant.id));
    const [reuse] = await db.insert(client).values({ name: "Synthetic reused slug", slug: f.tenant.slug }).returning();
    await setSynthesisBudget(reuse.slug, { ...policy, dailyRequests: 777 });
    assert.equal((await loadBudgetWorkspace(f.tenant.id)).budgets.find((item) => item.kind === "synthesis")?.policy, null);
  });

  if (process.env.TEST_HTTP === "1") await t.test("budget HTTP and server-rendered controls enforce role, tenant, origin and optimistic versions", async () => {
    const f = await fixture(); const other = await fixture();
    await setSynthesisBudget(other.tenant.slug, { ...policy, dailyRequests: 777 });
    const server = await startTestHttpServer(process.env.TEST_DATABASE_URL!);
    try {
      const edit = { kind: "synthesis", expectedVersion: null, confirmed: true, policy };
      const acquisitionEdit = { ...edit, kind: "acquisition", policy: { ...policy, dailyRecords: 10 } };
      assert.equal((await server.request("/api/configuration/budgets")).status, 401);
      for (const role of ["viewer", "researcher", "reviewer"]) {
        const denied = await fixture(role, f.tenant);
        assert.equal((await server.request("/api/configuration/budgets", denied.token)).status, 403);
        assert.equal((await server.request("/api/configuration/budgets", denied.token, edit)).status, 403);
        assert.equal((await server.request("/api/configuration/budgets", denied.token, acquisitionEdit)).status, 403);
        const html = await (await server.request("/configuration", denied.token)).text();
        assert.equal(html.includes("Budgets &amp; recovery"), false); assert.equal(html.includes("Edit synthesis budget"), false);
      }
      assert.equal((await server.request("/api/configuration/budgets", f.token, edit, "https://foreign.invalid")).status, 403);
      for (const invalid of [{ ...edit, clientId: other.tenant.id }, { ...edit, confirmed: false }, { ...edit, actorUserId: other.user.id }, { ...edit, oversized: "x".repeat(5000) }]) {
        assert.equal((await server.request("/api/configuration/budgets", f.token, invalid)).status, 400);
      }
      const created = await server.request("/api/configuration/budgets", f.token, edit);
      assert.equal(created.status, 200); assert.match(created.headers.get("cache-control") ?? "", /no-store/);
      assert.equal((await created.json()).budgets.find((row: { kind: string }) => row.kind === "synthesis").policy.version, 1);
      assert.equal((await server.request("/api/configuration/budgets", f.token, edit)).status, 409);
      assert.equal((await inspectSynthesisBudget(f.tenant.slug)).policy?.version, 1);
      assert.equal((await inspectSynthesisBudget(other.tenant.slug)).policy?.dailyRequests, 777);
      const acquisitionOwner = await fixture("owner");
      assert.equal((await server.request("/api/configuration/budgets", acquisitionOwner.token, acquisitionEdit)).status, 200);
      assert.equal((await server.request("/api/configuration/budgets", acquisitionOwner.token, acquisitionEdit)).status, 409);
      assert.equal((await inspectAcquisitionBudget(acquisitionOwner.tenant.slug)).policy?.version, 1);
      const scoped = await server.request(`/api/configuration/budgets?clientId=${other.tenant.id}`, f.token);
      const scopedView = await scoped.json();
      assert.equal(scopedView.budgets.find((row: { kind: string }) => row.kind === "synthesis").policy.dailyRequests, 5);
      const html = await (await server.request("/configuration", f.token)).text();
      assert.equal(html.includes("Budgets &amp; recovery"), true); assert.equal(html.includes("Edit synthesis budget"), true);
      if (process.env.TEST_BROWSER_MODULE) {
        const { runBudgetBrowserCase } = await import("./budget-browser");
        await runBudgetBrowserCase(server.base, f.token);
      }
      await db.update(clientMembership).set({ role: "viewer" }).where(and(eq(clientMembership.clientId, f.tenant.id), eq(clientMembership.userId, f.user.id)));
      assert.equal((await server.request("/api/configuration/budgets", f.token, { ...edit, expectedVersion: 1 })).status, 403);
    } finally { await server.stop(); }
  });
}
