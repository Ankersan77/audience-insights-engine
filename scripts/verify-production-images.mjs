#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { Client } from "pg";

const webImage = process.env.WEB_IMAGE;
const workerImage = process.env.WORKER_IMAGE;
const databaseUrl = process.env.TEST_WORKER_DATABASE_URL;
if (!webImage || !workerImage || !databaseUrl) throw new Error("WEB_IMAGE, WORKER_IMAGE and TEST_WORKER_DATABASE_URL are required");
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("worker image lifecycle proof is restricted to GitHub Actions");
const databaseTarget = new URL(databaseUrl);
assert.deepEqual({
  protocol: databaseTarget.protocol,
  hostname: databaseTarget.hostname,
  port: databaseTarget.port,
  username: databaseTarget.username,
  password: databaseTarget.password,
  pathname: databaseTarget.pathname,
  search: databaseTarget.search,
  hash: databaseTarget.hash,
}, {
  protocol: "postgresql:",
  hostname: "127.0.0.1",
  port: "5432",
  username: "postgres",
  password: "isolated-test-only",
  pathname: "/market_research_worker_test",
  search: "",
  hash: "",
}, "worker image lifecycle proof requires the exact isolated CI database target");

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function dockerAsync(args) {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return new Promise((resolve, reject) => child.once("close", (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`docker ${args.join(" ")} failed: ${(stderr || stdout).trim()}`));
  }));
}

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitForJob(boss, queue, id) {
  return waitFor(async () => {
    const [job] = await boss.findJobs(queue, { id });
    if (["failed", "cancelled"].includes(job?.state)) throw new Error(`${queue} job ${job.state}`);
    return job?.state === "completed" ? job : null;
  }, `${queue} job completion`);
}

const webInspect = JSON.parse(docker(["image", "inspect", webImage]))[0];
const workerInspect = JSON.parse(docker(["image", "inspect", workerImage]))[0];
for (const [label, image, inspect] of [["web", webImage, webInspect], ["worker", workerImage, workerInspect]]) {
  assert.ok(inspect.Id.startsWith("sha256:"), `${label} image needs immutable ID`);
  assert.notEqual(inspect.Config.User, "", `${label} image must declare a non-root user`);
  assert.notEqual(inspect.Config.User, "root", `${label} image must not run as root`);
  assert.notEqual(inspect.Config.User, "0", `${label} image must not run as UID 0`);
  docker(["run", "--rm", "--entrypoint", "sh", image, "-c", "! command -v python3 >/dev/null && ! command -v pip >/dev/null && test ! -e /app/vendor/last30days"]);
}
const webPackages = docker(["run", "--rm", "--entrypoint", "apk", webImage, "info"]).split("\n").filter(Boolean).sort();
const workerPackages = docker(["run", "--rm", "--entrypoint", "apk", workerImage, "info"]).split("\n").filter(Boolean).sort();
for (const packageName of [...webPackages, ...workerPackages]) assert.doesNotMatch(packageName, /^py3-|^python|^pip/);
assert.ok(workerInspect.Config.Healthcheck == null, "worker image must not inherit an HTTP healthcheck");
assert.ok(webInspect.Config.Healthcheck, "web image must retain its HTTP healthcheck");

const manifest = JSON.parse(docker(["run", "--rm", "--entrypoint", "cat", workerImage, "/app/worker-build.json"]));
const workerHash = docker(["run", "--rm", "--entrypoint", "sha256sum", workerImage, "/app/worker.mjs"]).split(/\s+/)[0];
assert.equal(workerHash, manifest.sha256);
assert.deepEqual(manifest.allowedQueues, [
  "market-research-source-acquisition",
  "market-research-canonical-maintenance",
  "market-research-synthesis-maintenance",
]);

const suffix = randomUUID().slice(0, 8);
const webContainer = `market-research-web-${suffix}`;
const workerContainer = `market-research-worker-${suffix}`;
const workerRestart = `${workerContainer}-restart`;
const workerEnvironment = [
  "-e", `DATABASE_URL=${databaseUrl}`,
  "-e", "MARKET_RESEARCH_CLIENT_SLUG=default-client",
  "-e", "MARKET_RESEARCH_CLIENT_ID=1",
];
let boss;
let proofClient;
try {
  docker(["run", "-d", "--name", webContainer, "-p", "3017:3000", webImage]);
  await waitFor(async () => fetch("http://127.0.0.1:3017/healthz").then((response) => response.ok).catch(() => false), "web health");
  const removedRoutes = [
    ["GET", "/brands"], ["GET", "/brands/1/instructions"], ["GET", "/runs"],
    ["GET", "/runs/1"], ["GET", "/insights"], ["POST", "/api/brands"],
    ["PATCH", "/api/brands/1"], ["POST", "/api/brands/1/instructions"],
    ["POST", "/api/runs/trigger"], ["POST", "/api/runs/1/cancel"],
    ["GET", "/api/insights/1/decision"], ["POST", "/api/insights/1/decision"],
    ["GET", "/monitoring"], ["GET", "/api/monitoring/briefings"],
    ["POST", "/api/monitoring/briefings/1/review"], ["POST", "/api/monitoring/briefings/settings"],
    ["GET", "/api/monitoring/profiles"], ["POST", "/api/monitoring/profiles"],
    ["POST", "/api/monitoring/run"], ["POST", "/api/monitoring/jobs/1/cancel"],
  ];
  for (const [method, path] of removedRoutes) {
    const response = await fetch(`http://127.0.0.1:3017${path}`, { method });
    assert.equal(response.status, 404, `${method} ${path} must return 404`);
  }
  const neutralCancellation = await fetch("http://127.0.0.1:3017/api/acquisition/jobs/1/cancel", { method: "POST" });
  assert.equal(neutralCancellation.status, 403, "neutral acquisition cancellation must remain present and permission-gated");

  docker(["run", "-d", "--name", workerContainer, "--network", "host", ...workerEnvironment, workerImage]);
  await waitFor(() => docker(["logs", workerContainer]).includes("subscribed to canonical queues"), "worker startup");

  boss = new PgBoss({ connectionString: databaseUrl, schedule: false, supervise: false });
  await boss.start();
  const expectedQueues = manifest.allowedQueues.toSorted();
  const queueNames = (await boss.getQueues()).map(({ name }) => name).toSorted();
  const infrastructureQueues = queueNames.filter((name) => name.startsWith("__pgboss__"));
  const productQueues = queueNames.filter((name) => !name.startsWith("__pgboss__"));
  assert.deepEqual(infrastructureQueues, ["__pgboss__send-it"]);
  assert.deepEqual(productQueues, expectedQueues);
  assert.deepEqual((await boss.getSchedules()).map(({ name }) => name).toSorted(), [
    "market-research-canonical-maintenance",
    "market-research-synthesis-maintenance",
  ]);
  const firstId = await boss.send("market-research-canonical-maintenance", {});
  assert.ok(firstId);
  await waitForJob(boss, "market-research-canonical-maintenance", firstId);

  proofClient = new Client({ connectionString: databaseUrl });
  await proofClient.connect();
  await proofClient.query("drop trigger if exists r1a2_delay_auth_session_delete on auth_session");
  await proofClient.query(`
    create or replace function r1a2_delay_auth_session_delete() returns trigger language plpgsql as $$
    begin
      perform pg_sleep(3);
      return null;
    end
    $$
  `);
  await proofClient.query(`
    create trigger r1a2_delay_auth_session_delete
    before delete on auth_session
    for each statement execute function r1a2_delay_auth_session_delete()
  `);
  const drainId = await boss.send("market-research-canonical-maintenance", {});
  assert.ok(drainId);
  await waitFor(async () => {
    const [job] = await boss.findJobs("market-research-canonical-maintenance", { id: drainId });
    return job?.state === "active";
  }, "in-flight maintenance job");
  const drainStartedAt = Date.now();
  const stopping = dockerAsync(["stop", "--time", "330", workerContainer]);
  await waitFor(() => docker(["logs", workerContainer]).includes("shutdown-started"), "worker shutdown start");
  await waitForJob(boss, "market-research-canonical-maintenance", drainId);
  await stopping;
  assert.ok(Date.now() - drainStartedAt >= 1_500, "SIGTERM must arrive while deterministic maintenance work is in flight");
  assert.ok(docker(["logs", workerContainer]).includes("shutdown-drained"), "worker must drain on SIGTERM");
  assert.equal(JSON.parse(docker(["inspect", workerContainer]))[0].State.ExitCode, 0, "worker must exit zero after SIGTERM");

  const catchUpId = await boss.send("market-research-canonical-maintenance", {});
  assert.ok(catchUpId);
  docker(["run", "-d", "--name", workerRestart, "--network", "host", ...workerEnvironment, workerImage]);
  await waitForJob(boss, "market-research-canonical-maintenance", catchUpId);
  assert.equal(await boss.getQueue("research-run"), null);
  assert.equal(await boss.getQueue("market-research-monitoring-scheduler"), null);
  assert.equal((await boss.getSchedules()).some(({ name }) => name === "market-research-monitoring-scheduler"), false);
  docker(["stop", "--time", "20", workerRestart]);

  const report = {
    schemaVersion: 1,
    revision: process.env.GITHUB_SHA ?? "local",
    web: { image: webImage, id: webInspect.Id, user: webInspect.Config.User, command: webInspect.Config.Cmd, apkPackages: webPackages },
    worker: { image: workerImage, id: workerInspect.Id, user: workerInspect.Config.User, command: workerInspect.Config.Cmd, apkPackages: workerPackages, artifactSha256: workerHash, buildManifest: manifest },
    assertions: { noPython: true, noVendoredEngine: true, removedRoutes404: removedRoutes.length, neutralCancellationPermissionGate: true, canonicalQueues: expectedQueues, pgBossInfrastructureQueues: infrastructureQueues, canonicalSchedules: ["market-research-canonical-maintenance", "market-research-synthesis-maintenance"], gracefulDrain: true, restartCatchUp: true },
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/r1a2-image-inspection.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`production-image-verification: OK (${webInspect.Id}, ${workerInspect.Id})`);
} finally {
  if (proofClient) {
    await proofClient.query("drop trigger if exists r1a2_delay_auth_session_delete on auth_session").catch(() => undefined);
    await proofClient.query("drop function if exists r1a2_delay_auth_session_delete()").catch(() => undefined);
    await proofClient.end().catch(() => undefined);
  }
  if (boss) await boss.stop({ graceful: true, timeout: 5_000 }).catch(() => undefined);
  for (const name of [workerRestart, workerContainer, webContainer]) {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
}
