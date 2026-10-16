import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  client: { type: "string" }, currency: { type: "string" }, "daily-cost-micros": { type: "string" },
  "daily-records": { type: "string" }, "daily-requests": { type: "string" }, enabled: { type: "string" },
} });
const action = positionals[0];
if (positionals.length !== 1 || !["show", "set"].includes(action) || !values.client
  || (action === "set" && (!values.currency || !["true", "false"].includes(values.enabled ?? "")
    || [values["daily-cost-micros"], values["daily-records"], values["daily-requests"]].some((value) => !value || !/^\d+$/.test(value))))
  || (action === "show" && Object.keys(values).some((key) => key !== "client"))) {
  throw new Error("Usage: npm run budget -- show --client SLUG, or set --client SLUG --currency DKK --daily-cost-micros INTEGER --daily-records INTEGER --daily-requests INTEGER --enabled true|false");
}
try { process.loadEnvFile(".env.local"); } catch { /* hosting environment supplies configuration */ }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { pool } = await import("../src/db/client");
try {
  const { setAcquisitionBudget, inspectAcquisitionBudget } = await import("../src/db/queries/acquisition_budget");
  if (action === "set") await setAcquisitionBudget(values.client, { currency: values.currency!, dailyCostMicros: Number(values["daily-cost-micros"]), dailyRecords: Number(values["daily-records"]), dailyRequests: Number(values["daily-requests"]), enabled: values.enabled === "true" });
  console.log(JSON.stringify(await inspectAcquisitionBudget(values.client)));
} catch {
  console.error("Budget operation failed. Check explicit bounds, client, migration and currency (locked after first authorization). No automatic retry was performed.");
  process.exitCode = 1;
} finally { await pool.end(); }
