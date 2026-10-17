import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { slug: { type: "string" }, name: { type: "string" } } });
const slug = values.slug?.trim();
const name = values.name?.trim();
if (!slug || !/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug) || !name || name.length > 200)
  throw new Error("Usage: pnpm deployment:bootstrap --slug CLIENT_SLUG --name CLIENT_NAME");
try { process.loadEnvFile(".env.local"); } catch { /* production injects configuration */ }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { pool } = await import("../src/db/client");
const connection = await pool.connect();
try {
  await connection.query("begin");
  await connection.query("lock table public.client in access exclusive mode");
  const clients = await connection.query<{ id: number; slug: string }>("select id, slug from public.client limit 2");
  if (clients.rows.length !== 1 || clients.rows[0].slug !== "default-client") throw new Error("not-an-unprovisioned-database");
  const tables = await connection.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' and tablename <> 'client'");
  for (const { tablename } of tables.rows) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const nonempty = await connection.query(`select 1 from public.${quoted} limit 1`);
    if (nonempty.rowCount) throw new Error("database-contains-existing-client-data");
  }
  await connection.query("update public.client set slug = $1, name = $2 where id = $3", [slug, name, clients.rows[0].id]);
  await connection.query("commit");
  console.log(`client-owned bootstrap complete: ${slug}, client ID ${clients.rows[0].id}`);
} catch {
  await connection.query("rollback");
  console.error("Bootstrap refused: use only a freshly migrated, otherwise empty database with the default-client placeholder. Existing data needs a reviewed migration.");
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
