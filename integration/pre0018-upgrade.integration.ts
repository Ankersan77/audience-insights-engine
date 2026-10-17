import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Client, Pool, type PoolClient } from "pg";

type Journal = {
  version: string;
  dialect: string;
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};

const CURRENT_HEAD = "0018_large_nick_fury";
const PRE_UPGRADE_HEAD = "0017_acquisition_budget_version";
const SNAPSHOT_TABLES = [
  "app_user", "client", "ability_manifest", "market", "brand", "brand_market",
  "research_instruction", "channel", "insight_route", "research_run", "evidence",
  "insight", "insight_evidence", "audit_log",
] as const;

const baseUrl = process.env.TEST_DATABASE_URL;
if (!baseUrl || !new URL(baseUrl).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test");
if (process.env.NODE_ENV === "production") throw new Error("Upgrade integration tests must not run in production mode");

function quotedFixtureDatabase(name: string): string {
  if (!/^market_research_upgrade_[a-f0-9]{16}_test$/.test(name) || name.length > 63)
    throw new Error("unsafe-upgrade-fixture-database-name");
  return `"${name}"`;
}

async function createPreUpgradeMigrationFolder(sourceFolder: string, journal: Journal): Promise<string> {
  assert.equal(journal.entries.at(-1)?.tag, CURRENT_HEAD, "fixture must track the repository migration head");
  const preUpgradeEntries = journal.entries.slice(0, -1);
  assert.equal(preUpgradeEntries.at(-1)?.tag, PRE_UPGRADE_HEAD, "fixture must start immediately before 0018");
  const folder = await mkdtemp(join(tmpdir(), "market-research-pre0018-"));
  await mkdir(join(folder, "meta"));
  await writeFile(join(folder, "meta", "_journal.json"), `${JSON.stringify({ ...journal, entries: preUpgradeEntries }, null, 2)}\n`, "utf8");
  for (const entry of preUpgradeEntries)
    await cp(join(sourceFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`), { errorOnExist: true });
  return folder;
}

async function migrationHistory(pool: Pool) {
  const { rows } = await pool.query<{ hash: string; created_at: string }>(
    "select hash, created_at::text from drizzle.__drizzle_migrations order by created_at, id",
  );
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

async function legacySnapshot(pool: Pool) {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    const { rows } = await pool.query<{ payload: unknown }>(
      `select to_jsonb(source_row) payload from public.${table} source_row order by to_jsonb(source_row)::text`,
    );
    snapshot[table] = rows.map((row) => row.payload);
  }
  return snapshot;
}

async function insertRepresentativeLegacyRows(pool: Pool) {
  const client: PoolClient = await pool.connect();
  await client.query("begin");
  try {
    const { rows: [user] } = await client.query<{ id: number }>(`
      insert into public.app_user (email, name, role, sso_subject_id, created_at, last_login_at)
      values ('legacy-upgrade@example.invalid', 'Legacy Upgrade Fixture', 'admin', 'legacy-upgrade-subject',
              '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z') returning id
    `);
    const { rows: [installationClient] } = await client.query<{ id: number }>(
      "select id from public.client where slug='default-client'",
    );
    const { rows: [market] } = await client.query<{ id: number }>(`
      insert into public.market (code, name, processing_enabled)
      values ('UPGRADE-DK', 'Upgrade Fixture Market', true) returning id
    `);
    const { rows: [brand] } = await client.query<{ id: number }>(`
      insert into public.brand (client_id, name, slug, description, status, created_by, created_at, updated_by, updated_at)
      values ($1, 'Upgrade Fixture Brand', 'upgrade-fixture-brand', 'Legacy row preservation fixture',
              'active', $2, '2025-01-03T00:00:00Z', $2, '2025-01-04T00:00:00Z') returning id
    `, [installationClient.id, user.id]);
    await client.query(
      "insert into public.brand_market (brand_id, market_id, ga4_property_id) values ($1, $2, 'legacy-ga4-fixture')",
      [brand.id, market.id],
    );
    await client.query(`
      insert into public.research_instruction
        (brand_id, market_id, version, subreddits, dedicated_subreddits, x_handle, x_related,
         tiktok_hashtags, competitors, focus_text, updated_by, updated_at)
      values ($1, $2, 7, array['upgrade-general'], array['upgrade-dedicated'], 'legacy_handle',
              array['related_handle'], array['upgrade-tag'], array['Fixture Competitor'],
              'Preserve this legacy instruction.', $3, '2025-01-05T00:00:00Z')
    `, [brand.id, market.id, user.id]);
    const { rows: [channel] } = await client.query<{ id: number }>(`
      insert into public.channel (type, external_ref, display_name, created_by, created_at)
      values ('slack_channel', 'legacy-upgrade-channel', 'Upgrade Fixture Channel', $1, '2025-01-06T00:00:00Z') returning id
    `, [user.id]);
    await client.query(
      "insert into public.insight_route (brand_id, insight_type, channel_id) values ($1, 'upgrade-fixture', $2)",
      [brand.id, channel.id],
    );
    const { rows: [run] } = await client.query<{ id: number }>(`
      insert into public.research_run
        (client_id, brand_id, market_id, research_instruction_version, triggered_by, status,
         started_at, finished_at, timed_out_at, error_message)
      values ($1, $2, $3, 7, $4, 'succeeded', '2025-01-07T00:00:00Z',
              '2025-01-07T00:05:00Z', null, null) returning id
    `, [installationClient.id, brand.id, market.id, user.id]);
    const { rows: [evidence] } = await client.query<{ id: number }>(`
      insert into public.evidence
        (run_id, source, external_id, url, author_handle, published_at, text_snippet,
         engagement_json, retrieved_at, sensitivity_flag)
      values ($1, 'legacy-fixture-source', 'legacy-fixture-external-id',
              'https://example.invalid/legacy-upgrade', 'legacy_author', '2025-01-01T00:00:00Z',
              'Legacy evidence must survive the upgrade.', '{"likes":12}'::jsonb,
              '2025-01-07T00:04:00Z', true) returning id
    `, [run.id]);
    const { rows: [insight] } = await client.query<{ id: number }>(`
      insert into public.insight
        (client_id, brand_id, market_id, run_id, insight_type, title, summary, shift_or_blip,
         confidence, status, reviewed_by, reviewed_at, routed_at, delivery_status)
      values ($1, $2, $3, $4, 'upgrade-fixture', 'Legacy insight fixture',
              'Preserve this legacy insight.', 'shift', 0.75, 'accepted', $5,
              '2025-01-08T00:00:00Z', '2025-01-08T00:01:00Z', 'delivered') returning id
    `, [installationClient.id, brand.id, market.id, run.id, user.id]);
    await client.query(
      "insert into public.insight_evidence (insight_id, evidence_id) values ($1, $2)",
      [insight.id, evidence.id],
    );
    await client.query(`
      insert into public.audit_log
        (user_id, action, entity_type, entity_id, before_json, after_json, created_at)
      values ($1, 'legacy-upgrade-fixture', 'insight', $2, '{"status":"pending"}'::jsonb,
              '{"status":"accepted"}'::jsonb, '2025-01-08T00:02:00Z')
    `, [user.id, insight.id]);
    await client.query(`
      insert into public.ability_manifest
        (client_id, ability_key, version, manifest_json, status, created_at)
      values ($1, 'competitor-intelligence', '1.0.0', '{"fixture":"pre-0018"}'::jsonb,
              'active', '2025-01-09T00:00:00Z')
    `, [installationClient.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

test("representative pre-0018 legacy rows survive immutable migration history through 0018", async () => {
  const repositoryMigrationFolder = resolve(process.cwd(), "drizzle");
  const journal = JSON.parse(await readFile(join(repositoryMigrationFolder, "meta", "_journal.json"), "utf8")) as Journal;
  const fullMigrations = readMigrationFiles({ migrationsFolder: repositoryMigrationFolder });
  assert.equal(fullMigrations.length, journal.entries.length);

  const databaseName = `market_research_upgrade_${randomUUID().replaceAll("-", "").slice(0, 16)}_test`;
  const quotedDatabase = quotedFixtureDatabase(databaseName);
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const fixtureUrl = new URL(baseUrl);
  fixtureUrl.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: adminUrl.toString(), application_name: "pre0018-upgrade-fixture-admin" });
  let fixture: Pool | null = null;
  let databaseCreated = false;
  let migrationFolder: string | null = null;

  await admin.connect();
  try {
    migrationFolder = await createPreUpgradeMigrationFolder(repositoryMigrationFolder, journal);
    await admin.query(`create database ${quotedDatabase} template template0 encoding 'UTF8'`);
    databaseCreated = true;
    fixture = new Pool({ connectionString: fixtureUrl.toString(), application_name: "pre0018-upgrade-fixture", max: 2 });
    const database = drizzle(fixture);

    await migrate(database, { migrationsFolder: migrationFolder });
    const preUpgradeHistory = await migrationHistory(fixture);
    assert.deepEqual(preUpgradeHistory, fullMigrations.slice(0, -1).map((entry) => ({ hash: entry.hash, createdAt: entry.folderMillis })));
    assert.equal(journal.entries.at(-2)?.tag, PRE_UPGRADE_HEAD);
    assert.equal(await fixture.query("select to_regclass('public.company_context_revision')::text relation").then((result) => result.rows[0].relation), null);

    await insertRepresentativeLegacyRows(fixture);
    const before = await legacySnapshot(fixture);
    for (const table of SNAPSHOT_TABLES) assert.ok(before[table].length > 0, `${table} must contain representative pre-0018 rows`);

    await migrate(database, { migrationsFolder: repositoryMigrationFolder });
    const after = await legacySnapshot(fixture);
    assert.deepEqual(after, before, "0018 must preserve every representative legacy row and field");

    const applied = await migrationHistory(fixture);
    assert.deepEqual(applied, fullMigrations.map((entry) => ({ hash: entry.hash, createdAt: entry.folderMillis })));
    assert.equal(applied.length, journal.entries.length);
    assert.equal(journal.entries.at(-1)?.tag, CURRENT_HEAD);
    assert.equal(await fixture.query("select to_regclass('public.company_context_revision')::text relation").then((result) => result.rows[0].relation), "company_context_revision");
  } finally {
    const cleanupErrors: unknown[] = [];
    if (fixture) {
      try { await fixture.end(); } catch (error) { cleanupErrors.push(error); }
    }
    if (databaseCreated) {
      try {
        await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try { await admin.query(`drop database ${quotedDatabase}`); } catch (error) { cleanupErrors.push(error); }
    }
    try { await admin.end(); } catch (error) { cleanupErrors.push(error); }
    if (migrationFolder) {
      try { await rm(migrationFolder, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "pre-0018 fixture cleanup failed");
  }
});
