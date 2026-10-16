import { parseArgs } from "node:util";
import { validTenantRole } from "../src/lib/authTokens";

// This CLI is the explicit trusted-operator path, not automatic login provisioning.
const { values, positionals } = parseArgs({ allowPositionals: true, options: { client: { type: "string" }, subject: { type: "string" }, role: { type: "string" }, "create-client-name": { type: "string" } } });
const action = positionals[0];
if (positionals.length !== 1 || !["grant", "revoke"].includes(action) || !values.client || !values.subject || (action === "grant" && !validTenantRole(values.role)) || (action === "revoke" && (values.role || values["create-client-name"]))) {
  throw new Error("Usage: pnpm access grant --client SLUG --subject OIDC_SUBJECT --role ROLE [--create-client-name NAME], or pnpm access revoke --client SLUG --subject OIDC_SUBJECT");
}
try { process.loadEnvFile(".env.local"); } catch { /* hosting environment supplies configuration */ }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { pool } = await import("../src/db/client");
try {
  const { setClientAccess } = await import("../src/db/queries/client_access");
  const result = await setClientAccess({ action: action as "grant" | "revoke", clientSlug: values.client, subject: values.subject, role: validTenantRole(values.role) ? values.role : undefined, createClientName: values["create-client-name"] });
  console.log(JSON.stringify(result));
} catch {
  console.error("Access change failed. Check the target client, subject uniqueness, database connection and migration status.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
