import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { parseSynthesisConfiguration, synthesisBindingDigest } from "../src/connectors/synthesisConfiguration.ts";

const { values } = parseArgs({ options: { file: { type: "string" }, "client-id": { type: "string" } } });
try {
  if (!values.file || !values["client-id"] || !/^[1-9]\d*$/.test(values["client-id"]) || (await stat(values.file)).size > 64_000) throw new Error();
  const binding = parseSynthesisConfiguration(await readFile(values.file, "utf8"), values["client-id"]);
  if (!binding) throw new Error();
  const scope = `research-synthesis:${synthesisBindingDigest(binding)}`;
  console.log(JSON.stringify({ clientId: binding.clientId, adapterId: binding.adapterId, model: binding.model, sourceConnectionIds: binding.sourceConnectionIds,
    processingGate: { key: "live_connectors", scope, evidenceReference: binding.approvalReference },
    qualityGate: { key: "research_quality", scope, evidenceReference: binding.qualityApprovalReference },
    expiresAt: binding.expiresAt, currency: binding.currency, maxCostMicros: binding.maxCostMicros,
    status: "Configuration shape only; no credentials read, approval granted or provider called." }));
} catch {
  console.error("Invalid synthesis configuration. Usage: npm run synthesis:check -- --file CONFIG_JSON --client-id NUMERIC_ID. No configuration or secret contents are printed on failure.");
  process.exitCode = 1;
}
