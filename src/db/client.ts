import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Shared Postgres connection pool and Drizzle client, used by every query
 * module and server-side helper (auth, audit, projects, ...). Cached on
 * `globalThis` in development so Next's module reloading does not open a new
 * pool per request.
 */
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const pool = globalForDb.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });
