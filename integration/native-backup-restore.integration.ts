import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { newSessionToken, sessionTokenHash } from "../src/lib/authTokens";
import { startTestHttpServer } from "./http-server";

const enabled = process.env.TEST_NATIVE_BACKUP_RESTORE === "1";
const baseUrl = process.env.TEST_DATABASE_URL;
const CI_DATABASE = {
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "isolated-test-only",
  baseDatabase: "market_research_test",
} as const;

function quotedFixtureDatabase(name: string): string {
  if (!/^market_research_(?:backup_source|restore)_[a-f0-9]{12}_test$/.test(name) || name.length > 63)
    throw new Error("unsafe-backup-restore-fixture-database-name");
  return `"${name}"`;
}

async function runDockerPostgresClient(args: string[], environment: NodeJS.ProcessEnv, label: string) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("docker", ["run", "--rm", "--network", "host", "-e", "PGPASSWORD", ...args], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4000); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed (${signal ?? `exit ${code}`}): ${output}`));
    });
  });
}

function connectionConfig(database: string, applicationName: string) {
  return {
    host: CI_DATABASE.host,
    port: CI_DATABASE.port,
    user: CI_DATABASE.user,
    password: CI_DATABASE.password,
    database,
    ssl: false,
    application_name: applicationName,
  } as const;
}

function fixtureUrl(database: string) {
  return `postgresql://${CI_DATABASE.user}:${CI_DATABASE.password}@${CI_DATABASE.host}:${CI_DATABASE.port}/${database}`;
}

async function createPreR1bMigrationFolder(parent: string): Promise<string> {
  const source = resolve(process.cwd(), "drizzle");
  const journal = JSON.parse(await readFile(join(source, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const boundary = journal.entries.findIndex((entry) => entry.tag === "0019_r1a1b_bounded_retention");
  assert.notEqual(boundary, -1, "the recoverable pre-R1B migration boundary must exist");
  const entries = journal.entries.slice(0, boundary + 1);
  const folder = join(parent, "pre-r1b-migrations");
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(join(folder, "meta", "_journal.json"), `${JSON.stringify({ ...journal, entries }, null, 2)}\n`, "utf8");
  for (const entry of entries) await cp(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  return folder;
}

test("PostgreSQL-native backup restores data and supports an authenticated release read", { skip: !enabled }, async (t) => {
  assert.ok(baseUrl, "TEST_DATABASE_URL is required when TEST_NATIVE_BACKUP_RESTORE=1");
  const parsedBaseUrl = new URL(baseUrl);
  assert.equal(process.env.GITHUB_ACTIONS, "true", "native backup/restore is restricted to the isolated GitHub Actions service");
  assert.equal(process.env.CI, "true", "native backup/restore requires the isolated CI environment");
  assert.equal(parsedBaseUrl.protocol, "postgresql:");
  assert.equal(parsedBaseUrl.hostname, CI_DATABASE.host);
  assert.equal(parsedBaseUrl.port, String(CI_DATABASE.port));
  assert.equal(decodeURIComponent(parsedBaseUrl.username), CI_DATABASE.user);
  assert.equal(decodeURIComponent(parsedBaseUrl.password), CI_DATABASE.password);
  assert.equal(parsedBaseUrl.pathname, `/${CI_DATABASE.baseDatabase}`);
  assert.equal(parsedBaseUrl.search, "", "connection routing parameters are forbidden");
  assert.equal(parsedBaseUrl.hash, "", "connection fragments are forbidden");
  assert.notEqual(process.env.NODE_ENV, "production", "backup/restore must not run in production mode");

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const sourceName = `market_research_backup_source_${suffix}_test`;
  const restoreName = `market_research_restore_${suffix}_test`;
  const restoreUrl = fixtureUrl(restoreName);
  const admin = new Client(connectionConfig("postgres", "native-backup-restore-admin"));
  const temporaryFolder = await mkdtemp(join(tmpdir(), "market-research-native-restore-"));
  const backupFile = join(temporaryFolder, "backup.dump");
  const mountedBackupFile = "/evidence/backup.dump";
  const createdDatabases: string[] = [];
  let source: Pool | null = null;
  let restored: Pool | null = null;
  let http: Awaited<ReturnType<typeof startTestHttpServer>> | undefined;
  const previousClientSlug = process.env.MARKET_RESEARCH_CLIENT_SLUG;

  await admin.connect();
  try {
    const preR1bMigrations = await createPreR1bMigrationFolder(temporaryFolder);
    await admin.query(`create database ${quotedFixtureDatabase(sourceName)} template template0 encoding 'UTF8'`);
    createdDatabases.push(sourceName);
    source = new Pool({ ...connectionConfig(sourceName, "native-backup-source"), max: 2 });
    await migrate(drizzle(source), { migrationsFolder: preR1bMigrations });

    const { rows: [tenant] } = await source.query<{ id: number }>(
      "insert into client (slug, name) values ($1, $2) returning id",
      [`restore-fixture-${suffix}`, "Native restore fixture"],
    );
    const { rows: [user] } = await source.query<{ id: number }>(
      "insert into app_user (email, name, role, sso_subject_id) values ($1, $2, 'researcher', $3) returning id",
      [`restore-${suffix}@example.invalid`, "Native restore researcher", `restore-subject-${suffix}`],
    );
    await source.query(
      "insert into client_membership (client_id, user_id, role) values ($1, $2, 'researcher')",
      [tenant.id, user.id],
    );
    const { rows: [project] } = await source.query<{ id: number }>(
      "insert into research_project (client_id, name, decision, markets, languages, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
      [tenant.id, "Restore verification", "Prove native recovery", ["DK"], ["da"], user.id],
    );
    await source.query(
      `insert into research_artifact
        (client_id, project_id, artifact_key, artifact_type, ability_key, ability_version, status, version, payload_json, created_by)
       values ($1, $2, $3, 'recovery-proof', 'competitor-intelligence', '1.0.0', 'accepted', 1, $4::jsonb, $5)`,
      [tenant.id, project.id, `restore-proof-${suffix}`, JSON.stringify({ marker: suffix, peopleBlind: true }), user.id],
    );
    const { rows: [legacyMarket] } = await source.query<{ id: number }>(
      "insert into market (code, name, processing_enabled) values ($1, 'R1B recovery fixture', true) returning id",
      [`RECOVERY-${suffix}`],
    );
    const { rows: [legacyBrand] } = await source.query<{ id: number }>(
      `insert into brand (client_id, name, slug, status, created_by, updated_by)
       values ($1, 'R1B recovery fixture', $2, 'inactive', $3, $3) returning id`,
      [tenant.id, `recovery-${suffix}`, user.id],
    );
    const { rows: [legacyRun] } = await source.query<{ id: number }>(
      `insert into research_run
        (client_id, brand_id, market_id, research_instruction_version, triggered_by, status)
       values ($1, $2, $3, 1, $4, 'succeeded') returning id`,
      [tenant.id, legacyBrand.id, legacyMarket.id, user.id],
    );
    const legacyHandle = `legacy-recovery-${suffix}`;
    await source.query(
      `insert into evidence (run_id, source, external_id, author_handle, text_snippet)
       values ($1, 'recovery-fixture', $2, $3, 'Identity-bearing pre-R1B recovery canary')`,
      [legacyRun.id, `recovery-${suffix}`, legacyHandle],
    );
    await source.query(
      `insert into audit_log (user_id, action, entity_type, entity_id, before_json)
       values ($1, 'r1b-recovery-fixture', 'evidence', $2, $3::jsonb)`,
      [user.id, legacyRun.id, JSON.stringify({ legacyHandle })],
    );
    const expected = (await source.query(
      `select
         (select count(*)::int from client) client_count,
         (select count(*)::int from research_project) project_count,
         (select count(*)::int from research_artifact) artifact_count,
         (select count(*)::int from evidence where author_handle=$1) legacy_identity_count,
         (select count(*)::int from drizzle.__drizzle_migrations) migration_count`,
      [legacyHandle],
    )).rows[0];
    assert.equal(expected.migration_count, 19, "backup must be captured at the pre-R1B head");
    assert.equal(expected.legacy_identity_count, 1, "backup must contain the representative identity-bearing legacy row");

    const dockerEnvironment = { ...process.env, PGPASSWORD: CI_DATABASE.password };
    const connectionArgs = [
      "postgres:16-alpine",
      "pg_dump",
      "--host", CI_DATABASE.host,
      "--port", String(CI_DATABASE.port),
      "--username", CI_DATABASE.user,
      "--dbname", sourceName,
      "--format", "custom",
      "--no-owner",
      "--no-privileges",
      "--file", mountedBackupFile,
    ];
    const dumpStartedAt = Date.now();
    const recoveryPoint = new Date(dumpStartedAt).toISOString();
    await runDockerPostgresClient(
      ["-v", `${temporaryFolder}:/evidence`, ...connectionArgs],
      dockerEnvironment,
      "pg_dump",
    );
    const backupDurationMs = Date.now() - dumpStartedAt;
    const backup = await readFile(backupFile);
    const backupSha256 = createHash("sha256").update(backup).digest("hex");
    const backupBytes = (await stat(backupFile)).size;
    assert.ok(backupBytes > 0, "native backup must not be empty");

    const recoveryStartedAt = Date.now();
    await admin.query(`create database ${quotedFixtureDatabase(restoreName)} template template0 encoding 'UTF8'`);
    createdDatabases.push(restoreName);
    const restoreCommandStartedAt = Date.now();
    await runDockerPostgresClient([
      "-v", `${temporaryFolder}:/evidence`,
      "postgres:16-alpine",
      "pg_restore",
      "--host", CI_DATABASE.host,
      "--port", String(CI_DATABASE.port),
      "--username", CI_DATABASE.user,
      "--dbname", restoreName,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      mountedBackupFile,
    ], dockerEnvironment, "pg_restore");
    const restoreCommandDurationMs = Date.now() - restoreCommandStartedAt;

    restored = new Pool({ ...connectionConfig(restoreName, "native-backup-restored"), max: 2 });
    const restoredPreR1b = (await restored.query(
      `select
         (select count(*)::int from client) client_count,
         (select count(*)::int from research_project) project_count,
         (select count(*)::int from research_artifact) artifact_count,
         (select count(*)::int from evidence where author_handle=$1) legacy_identity_count,
         (select count(*)::int from drizzle.__drizzle_migrations) migration_count`,
      [legacyHandle],
    )).rows[0];
    assert.deepEqual(restoredPreR1b, expected, "canonical and legacy records at the 0019 boundary must survive native restore");
    const forwardStartedAt = Date.now();
    await migrate(drizzle(restored), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    const forwardMigrationDurationMs = Date.now() - forwardStartedAt;
    const actual = (await restored.query(
      `select
         (select count(*)::int from client) client_count,
         (select count(*)::int from research_project) project_count,
         (select count(*)::int from research_artifact) artifact_count,
         (select count(*)::int from drizzle.__drizzle_migrations) migration_count`,
    )).rows[0];
    assert.deepEqual(actual, {
      client_count: expected.client_count,
      project_count: expected.project_count,
      artifact_count: expected.artifact_count,
      migration_count: 20,
    }, "restored canonical records must survive the R1B forward migration");
    for (const relation of ["ability_manifest", "market", "brand", "brand_market", "research_instruction", "channel", "insight_route", "research_run", "evidence", "insight", "insight_evidence", "audit_log"]) {
      assert.equal(await restored.query("select to_regclass($1)::text relation", [`public.${relation}`]).then((result) => result.rows[0].relation), null);
    }
    const { rows: [artifact] } = await restored.query<{ payload_json: { marker: string; peopleBlind: boolean } }>(
      "select payload_json from research_artifact where artifact_key=$1",
      [`restore-proof-${suffix}`],
    );
    assert.deepEqual(artifact.payload_json, { marker: suffix, peopleBlind: true });

    const token = newSessionToken();
    const tokenHash = sessionTokenHash(token);
    assert.ok(tokenHash);
    await restored.query(
      "insert into auth_session (token_hash, client_id, user_id, created_at, expires_at) values ($1, $2, $3, now(), now() + interval '1 hour')",
      [tokenHash, tenant.id, user.id],
    );
    process.env.MARKET_RESEARCH_CLIENT_SLUG = `restore-fixture-${suffix}`;
    http = await startTestHttpServer(restoreUrl);
    const projectsResponse = await http.request("/api/projects", token);
    const projectsText = await projectsResponse.text();
    assert.equal(projectsResponse.status, 200, projectsText);
    const projectsBody = JSON.parse(projectsText) as { projects: { id: string; name: string }[] };
    assert.ok(projectsBody.projects.some((item) => item.id === String(project.id) && item.name === "Restore verification"),
      "the current release must complete an authenticated database-backed read after restore");
    const syntheticRecoveryDurationMs = Date.now() - recoveryStartedAt;

    const compatibility = JSON.parse(await readFile(resolve(process.cwd(), "compatibility-manifest.json"), "utf8")) as {
      database: { migrationHead: string; historyDigest: string };
    };
    const evidenceReport = {
      schemaVersion: 1,
      evidence: "r1b-native-backup-restore-forward-again",
      revision: process.env.GITHUB_SHA ?? null,
      engine: "postgresql-16",
      method: "pg_dump-custom/pg_restore",
      backupId: `synthetic:${sourceName}:${recoveryPoint}`,
      recoveryPoint,
      timingScope: "synthetic-ci-fixture-not-service-slo",
      backupDurationMs,
      restoreCommandDurationMs,
      syntheticRecoveryDurationMs,
      forwardMigrationDurationMs,
      backupBytes,
      backupSha256: `sha256:${backupSha256}`,
      preR1bMigrationCount: restoredPreR1b.migration_count,
      ...actual,
      restoredRecordCountsMatch: true,
      r1bForwardMigration: "ok",
      migrationHead: compatibility.database.migrationHead,
      migrationHistoryDigest: compatibility.database.historyDigest,
      contractedLegacyRelations: 12,
      contractedLegacyTypes: 3,
      authenticatedReleaseRead: "ok",
    };
    const artifactFolder = resolve(process.cwd(), "artifacts");
    await mkdir(artifactFolder, { recursive: true });
    await writeFile(join(artifactFolder, "r1b-recovery-evidence.json"), `${JSON.stringify(evidenceReport, null, 2)}\n`, "utf8");
    t.diagnostic(JSON.stringify(evidenceReport));
  } finally {
    const cleanupErrors: unknown[] = [];
    if (http) {
      try { await http.stop(); } catch (error) { cleanupErrors.push(error); }
    }
    if (restored) {
      try { await restored.end(); } catch (error) { cleanupErrors.push(error); }
    }
    if (source) {
      try { await source.end(); } catch (error) { cleanupErrors.push(error); }
    }
    for (const databaseName of createdDatabases.reverse()) {
      try {
        await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]);
        await admin.query(`drop database ${quotedFixtureDatabase(databaseName)}`);
      } catch (error) { cleanupErrors.push(error); }
    }
    try { await admin.end(); } catch (error) { cleanupErrors.push(error); }
    try { await rm(temporaryFolder, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (previousClientSlug === undefined) delete process.env.MARKET_RESEARCH_CLIENT_SLUG;
    else process.env.MARKET_RESEARCH_CLIENT_SLUG = previousClientSlug;
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "native backup/restore cleanup failed");
  }
});
