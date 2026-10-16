import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  client: { type: "string" }, currency: { type: "string" }, "daily-cost-micros": { type: "string" },
  "daily-requests": { type: "string" }, enabled: { type: "string" },
} });
const action = positionals[0];
if (positionals.length !== 1 || !["show", "set", "reconcile"].includes(action) || !values.client
  || (action === "set" && (!values.currency || !["true", "false"].includes(values.enabled ?? "")
    || [values["daily-cost-micros"], values["daily-requests"]].some((value) => !value || !/^\d+$/.test(value))))
  || (action !== "set" && Object.keys(values).some((key) => key !== "client"))) {
  throw new Error("Usage: npm run synthesis:budget -- show|reconcile --client SLUG, or set --client SLUG --currency DKK --daily-cost-micros INTEGER --daily-requests INTEGER --enabled true|false");
}
try { process.loadEnvFile(".env.local"); } catch { /* hosting environment supplies configuration */ }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { pool } = await import("../src/db/client");
try {
  const { setSynthesisBudget, inspectSynthesisBudget, reconcileSynthesisAttempts } = await import("../src/db/queries/synthesis_budget");
  if (action === "set") await setSynthesisBudget(values.client, { currency: values.currency!, dailyCostMicros: Number(values["daily-cost-micros"]), dailyRequests: Number(values["daily-requests"]), enabled: values.enabled === "true" });
  if (action === "reconcile") console.log(JSON.stringify({ reconciled: await reconcileSynthesisAttempts(values.client) }));
  console.log(JSON.stringify(await inspectSynthesisBudget(values.client)));
} catch {
  console.error("Synthesis budget operation failed. Check explicit limits, client, migration and fixed currency. No call was retried or reservation refunded.");
  process.exitCode = 1;
} finally { await pool.end(); }
