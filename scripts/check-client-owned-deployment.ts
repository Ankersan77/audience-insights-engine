export {};
try { process.loadEnvFile(".env.local"); } catch { /* production injects secrets */ }
const { pool } = await import("../src/db/client");
try {
  const { assertClientOwnedDeployment } = await import("../src/lib/clientOwnedDeployment");
  await assertClientOwnedDeployment();
  console.log("client-owned deployment: one matching client in dedicated database");
} catch {
  console.error("client-owned deployment check failed: verify slug, numeric ID and exclusive database before release");
  process.exitCode = 1;
} finally {
  await pool.end();
}
