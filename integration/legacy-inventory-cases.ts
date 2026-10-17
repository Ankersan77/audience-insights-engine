import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { collectInventory } from "../scripts/legacy-inventory";

const LEGACY_TABLES = [
  "ability_manifest", "market", "brand", "brand_market", "research_instruction", "channel",
  "insight_route", "research_run", "evidence", "insight", "insight_evidence", "audit_log",
] as const;
const RUN_QUEUE = "research-run";

async function aggregateInventoryCounts(probe: Pool) {
  const legacy = Object.fromEntries(await Promise.all(LEGACY_TABLES.map(async (table) => {
    const { rows: [row] } = await probe.query<{ row_count: number }>(`select count(*)::int row_count from public.${table}`);
    return [table, row.row_count] as const;
  })));
  const { rows: [presence] } = await probe.query<{ job: string | null; queue: string | null; version: string | null }>(
    "select to_regclass('pgboss.job')::text job, to_regclass('pgboss.queue')::text queue, to_regclass('pgboss.version')::text version",
  );
  if (!presence.job || !presence.queue || !presence.version) return { legacy, queue: null };
  const [versions, queues, jobs] = await Promise.all([
    probe.query<{ version: number }>("select version from pgboss.version order by version desc"),
    probe.query<{ row_count: number }>("select count(*)::int row_count from pgboss.queue where name=$1", [RUN_QUEUE]),
    probe.query<{ state: string; row_count: number }>(
      "select state::text, count(*)::int row_count from pgboss.job where name=$1 group by state order by state",
      [RUN_QUEUE],
    ),
  ]);
  return {
    legacy,
    queue: {
      versions: versions.rows.map((row) => row.version),
      queueRows: queues.rows[0].row_count,
      states: Object.fromEntries(jobs.rows.map((row) => [row.state, row.row_count])),
    },
  };
}

function restoreEnvironment(name: "MARKET_RESEARCH_CLIENT_ID" | "MARKET_RESEARCH_CLIENT_SLUG", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// Called immediately after migrations and before the parent suite creates additional tenants.
export async function runLegacyInventoryCases(t: TestContext, probe: Pool, connectionString: string) {
  await t.test("legacy inventory is read-only, tenant-aware and reports pg-boss v12 state without payloads", async () => {
    const previousClientId = process.env.MARKET_RESEARCH_CLIENT_ID;
    const previousClientSlug = process.env.MARKET_RESEARCH_CLIENT_SLUG;
    let boss: PgBoss | null = null;
    let bossStarted = false;
    let createdRunQueue = false;
    const fixtureJobIds: string[] = [];
    let legacyFixtureIds: { insight: number; run: number; instruction: number; brand: number; market: number; user: number } | null = null;
    try {
      const { rows: tenants } = await probe.query<{ id: number; slug: string }>("select id, slug from public.client order by id");
      assert.deepEqual(tenants.map((tenant) => tenant.slug), ["default-client"]);
      const tenant = tenants[0];
      process.env.MARKET_RESEARCH_CLIENT_ID = String(tenant.id);
      process.env.MARKET_RESEARCH_CLIENT_SLUG = tenant.slug;

      const initialCounts = await aggregateInventoryCounts(probe);
      const initial = await collectInventory(connectionString, "integration-default-client");
      assert.equal(initial.discoveryState, "complete");
      assert.deepEqual(initial.discoveryFailures, []);
      assert.equal(initial.installation.clientId, tenant.id);
      assert.equal(initial.installation.clientScopeValidated, true);
      assert.equal(initial.database.migration.state, "exact");
      assert.equal(initial.database.readOnlySnapshot, true);
      assert.equal(initial.legacy.schemaPresence.discoveryState, "complete");
      assert.notEqual(initial.legacy.tables, null);
      assert.deepEqual(await aggregateInventoryCounts(probe), initialCounts, "inventory must not mutate legacy or queue aggregates");

      boss = new PgBoss({ connectionString, schedule: false, supervise: false });
      boss.on("error", () => undefined);
      await boss.start();
      bossStarted = true;
      assert.equal(await boss.getQueue(RUN_QUEUE), null, "the dedicated integration database must not contain a stale research-run queue");
      await boss.createQueue(RUN_QUEUE, { retryLimit: 0, expireInSeconds: 11 * 60 });
      createdRunQueue = true;

      const legacyStatusCanary = `UNTRUSTED-INSIGHT-STATUS-${randomUUID()}`;
      const { rows: [user] } = await probe.query<{ id: number }>(
        "insert into public.app_user (email,name,role,sso_subject_id) values ('inventory@example.invalid','Inventory fixture','viewer',$1) returning id",
        [randomUUID()],
      );
      const { rows: [market] } = await probe.query<{ id: number }>(
        "insert into public.market (code,name) values ($1,'Inventory fixture') returning id",
        [`IV${randomUUID().slice(0, 6)}`],
      );
      const { rows: [brand] } = await probe.query<{ id: number }>(
        "insert into public.brand (client_id,name,slug,status,created_by,updated_by) values ($1,'Inventory fixture',$2,'inactive',$3,$3) returning id",
        [tenant.id, `inventory-${randomUUID()}`, user.id],
      );
      const { rows: [instruction] } = await probe.query<{ id: number }>(
        "insert into public.research_instruction (brand_id,market_id,version,updated_by) values ($1,$2,1,$3) returning id",
        [brand.id, market.id, user.id],
      );
      const { rows: [run] } = await probe.query<{ id: number }>(
        "insert into public.research_run (client_id,brand_id,market_id,research_instruction_version,triggered_by,status) values ($1,$2,$3,1,$4,'succeeded') returning id",
        [tenant.id, brand.id, market.id, user.id],
      );
      const { rows: [legacyInsight] } = await probe.query<{ id: number }>(
        "insert into public.insight (client_id,brand_id,market_id,run_id,insight_type,title,summary,shift_or_blip,confidence,status) values ($1,$2,$3,$4,'fixture','Fixture','Fixture','blip',0.5,$5) returning id",
        [tenant.id, brand.id, market.id, run.id, legacyStatusCanary],
      );
      legacyFixtureIds = { insight: legacyInsight.id, run: run.id, instruction: instruction.id, brand: brand.id, market: market.id, user: user.id };

      const canaries = [
        `TENANT-JOB-PAYLOAD-${randomUUID()}`,
        `FOREIGN-JOB-PAYLOAD-${randomUUID()}`,
        `MALFORMED-JOB-PAYLOAD-${randomUUID()}`,
      ];
      const payloads = [
        { clientId: tenant.id, canary: canaries[0] },
        { clientId: tenant.id + 100_000, canary: canaries[1] },
        { clientId: `invalid-${tenant.id}`, canary: canaries[2] },
      ];
      for (const payload of payloads) {
        const id = await boss.send(RUN_QUEUE, payload);
        assert.ok(id);
        fixtureJobIds.push(id);
      }

      const fixtureCounts = await aggregateInventoryCounts(probe);
      const inventory = await collectInventory(connectionString, "integration-queue-fixtures");
      assert.equal(inventory.discoveryState, "complete");
      assert.equal(inventory.queue.schemaState, "complete");
      assert.equal(inventory.queue.schemaVersion, 45);
      assert.equal(inventory.queue.queuePresent, true);
      assert.deepEqual(inventory.queue.queueConfig, { retryLimit: 0, expireSeconds: 660, partition: false });
      assert.equal(inventory.queue.states.created, 3);
      assert.equal(inventory.queue.tenantStates?.created, 1);
      assert.equal(inventory.queue.foreignClientJobs, 1);
      assert.equal(inventory.queue.malformedClientScopeJobs, 1);
      assert.equal(inventory.queue.pendingCount, 3);
      assert.equal(inventory.legacy.statusCounts?.insight.other, 1);
      const serialized = JSON.stringify(inventory);
      for (const canary of canaries) assert.equal(serialized.includes(canary), false);
      assert.equal(serialized.includes(legacyStatusCanary), false);
      assert.deepEqual(await aggregateInventoryCounts(probe), fixtureCounts, "inventory must not mutate pg-boss or legacy aggregates");

      process.env.MARKET_RESEARCH_CLIENT_ID = String(tenant.id + 1);
      process.env.MARKET_RESEARCH_CLIENT_SLUG = "wrong-client";
      const beforeRejectedScope = await aggregateInventoryCounts(probe);
      const rejectedScope = await collectInventory(connectionString, "integration-wrong-scope");
      assert.equal(rejectedScope.discoveryState, "failed");
      assert.deepEqual(rejectedScope.discoveryFailures, ["client_scope_not_validated"]);
      assert.equal(rejectedScope.installation.clientId, null);
      assert.equal(rejectedScope.installation.clientScopeValidated, false);
      assert.equal(rejectedScope.legacy.tables, null);
      assert.equal(rejectedScope.queue.tenantStates, null);
      assert.deepEqual(await aggregateInventoryCounts(probe), beforeRejectedScope, "rejected tenant scope must remain read-only");

      await boss.deleteJob(RUN_QUEUE, fixtureJobIds);
      fixtureJobIds.length = 0;
      await boss.deleteQueue(RUN_QUEUE);
      createdRunQueue = false;
      assert.equal(await boss.getQueue(RUN_QUEUE), null);
      await boss.stop({ graceful: true, timeout: 5000 });
      bossStarted = false;

      await probe.query("delete from public.insight where id=$1", [legacyFixtureIds.insight]);
      await probe.query("delete from public.research_run where id=$1", [legacyFixtureIds.run]);
      await probe.query("delete from public.research_instruction where id=$1", [legacyFixtureIds.instruction]);
      await probe.query("delete from public.brand where id=$1", [legacyFixtureIds.brand]);
      await probe.query("delete from public.market where id=$1", [legacyFixtureIds.market]);
      await probe.query("delete from public.app_user where id=$1", [legacyFixtureIds.user]);
      legacyFixtureIds = null;
      assert.deepEqual((await aggregateInventoryCounts(probe)).legacy, initialCounts.legacy, "integration fixtures must restore legacy aggregates");
    } finally {
      if (boss && createdRunQueue) {
        if (fixtureJobIds.length) await boss.deleteJob(RUN_QUEUE, fixtureJobIds).catch(() => undefined);
        await boss.deleteQueue(RUN_QUEUE).catch(() => undefined);
      }
      if (boss && bossStarted) await boss.stop({ graceful: true, timeout: 5000 }).catch(() => undefined);
      if (legacyFixtureIds) {
        await probe.query("delete from public.insight where id=$1", [legacyFixtureIds.insight]).catch(() => undefined);
        await probe.query("delete from public.research_run where id=$1", [legacyFixtureIds.run]).catch(() => undefined);
        await probe.query("delete from public.research_instruction where id=$1", [legacyFixtureIds.instruction]).catch(() => undefined);
        await probe.query("delete from public.brand where id=$1", [legacyFixtureIds.brand]).catch(() => undefined);
        await probe.query("delete from public.market where id=$1", [legacyFixtureIds.market]).catch(() => undefined);
        await probe.query("delete from public.app_user where id=$1", [legacyFixtureIds.user]).catch(() => undefined);
      }
      restoreEnvironment("MARKET_RESEARCH_CLIENT_ID", previousClientId);
      restoreEnvironment("MARKET_RESEARCH_CLIENT_SLUG", previousClientSlug);
    }
  });
}
