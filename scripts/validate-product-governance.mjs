#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const allowedReleaseStates = ["designed", "implemented", "externally_validated", "production_supported", "deprecated", "removed"];
const allowedClassifications = ["v1", "supporting", "parked", "remove"];
const allowedLayers = ["core", "application", "adapter", "operations", "surface", "product", "legacy"];
const allowedDataClasses = ["authentication", "client-confidential", "configuration", "first-party-aggregate", "identity-bearing-public-source", "licensed", "operational-metadata", "primary-research", "public"];
const allowedHumanGates = ["access-provisioning", "architecture-review", "budget-approval", "campaign-approval", "configuration-review", "data-disposition-approval", "host-conformance", "identity-provider-acceptance", "learning-review", "legacy-code-removal-data-access", "live-adapter-acceptance", "market-twin-review", "material-recommendation", "method-review", "model-provider-acceptance", "monitoring-quality", "operations-review", "owner-declaration", "privacy-review", "product-acceptance", "research-quality", "restore-evidence", "result-language-review", "security-review", "source-rights-approval"];
const activeStateRank = { designed: 0, implemented: 1, externally_validated: 2, production_supported: 3 };
const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const wireId = /^[a-z][a-z0-9-]+@[1-9][0-9]*$/;

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
    return "";
  }
  return result.stdout.trim();
}

function gitRaw(args) {
  const result = spawnSync("git", args, { cwd: root });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
    return Buffer.alloc(0);
  }
  return result.stdout;
}

function exactKeys(label, value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
    return;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains unknown field ${key}.`);
  for (const key of allowed) if (!(key in value)) fail(`${label} is missing field ${key}.`);
}

function allowedKeys(label, value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
    return;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains unknown field ${key}.`);
}

function unique(label, values) {
  if (!Array.isArray(values)) {
    fail(`${label} must be an array.`);
    return;
  }
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains duplicate ${String(value)}.`);
    seen.add(value);
  }
}

function requirePath(label, path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.split("/").includes("..")) {
    fail(`${label} must be a normalized repository-relative path.`);
  } else if (!existsSync(join(root, path))) {
    fail(`${label} does not exist: ${path}.`);
  }
}

function verifyDurableEvidence(label, evidence) {
  allowedKeys(label, evidence, ["ref", "digest", "verifiedAt", "expiresAt"]);
  for (const field of ["ref", "digest", "verifiedAt", "expiresAt"]) if (!evidence?.[field]) fail(`${label} is missing ${field}.`);
  requirePath(`${label} ref`, evidence?.ref);
  if (!/^sha256:[0-9a-f]{64}$/.test(evidence?.digest ?? "")) fail(`${label} digest must be sha256:<64 lowercase hex>.`);
  else if (existsSync(join(root, evidence.ref))) {
    const actual = `sha256:${createHash("sha256").update(readFileSync(join(root, evidence.ref))).digest("hex")}`;
    if (evidence.digest !== actual) fail(`${label} digest does not match ${evidence.ref}.`);
  }
  const verifiedAt = Date.parse(evidence?.verifiedAt ?? "");
  const expiresAt = Date.parse(evidence?.expiresAt ?? "");
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt) || expiresAt <= verifiedAt) fail(`${label} needs valid increasing verifiedAt/expiresAt timestamps.`);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) fail(`${label} has expired.`);
}

function sameMembers(label, expected, actual) {
  const a = [...expected].sort();
  const b = [...actual].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(`${label} drifted. Expected ${JSON.stringify(a)}, found ${JSON.stringify(b)}.`);
  }
}

const compatibility = readJson("compatibility-manifest.json");
const capabilities = readJson("product-capabilities.json");
const decisions = readJson("product-decisions.json");
const baseline = readJson("r0-baseline.json");
const packageJson = readJson("package.json");
const journal = readJson("drizzle/meta/_journal.json");
const blueprint = readFileSync(join(root, "BLUEPRINT.md"), "utf8");
const roadmap = readFileSync(join(root, "ROADMAP.md"), "utf8");

exactKeys("compatibility-manifest.json", compatibility, ["manifestSchemaVersion", "product", "blueprint", "roadmap", "capabilityRegister", "decisionRegister", "baseline", "core", "database", "contracts", "mcp", "abilities", "hosts", "sourcePaths", "transition"]);
exactKeys("product-capabilities.json", capabilities, ["schemaVersion", "product", "blueprintVersion", "updated", "classifications", "releaseStates", "capabilities"]);
exactKeys("product-decisions.json", decisions, ["schemaVersion", "product", "updated", "statusRule", "ownerAssignments", "decisions"]);
exactKeys("r0-baseline.json", baseline, ["schemaVersion", "capturedAt", "baselineCommit", "preTrimTag", "migrationHead", "migrationHistoryDigest", "routeHandlers", "pageRoutes", "queues", "schemaTables", "providerDependencies", "productionSourceAdapters", "legacyLast30days", "legacySchema", "verification", "r0Subgates", "r0GateStatus", "openBlockers"]);
exactKeys("compatibility.product", compatibility.product, ["id", "generation", "releaseVersion", "releaseVersionSource", "buildRevisionSource"]);
exactKeys("compatibility.blueprint", compatibility.blueprint, ["path", "version"]);
exactKeys("compatibility.roadmap", compatibility.roadmap, ["path", "blueprintVersion"]);
for (const key of ["capabilityRegister", "decisionRegister", "baseline"]) exactKeys(`compatibility.${key}`, compatibility[key], ["path", "schemaVersion"]);
exactKeys("compatibility.core", compatibility.core, ["id", "version", "state", "source", "limitation"]);
exactKeys("compatibility.database", compatibility.database, ["engine", "schemaVersion", "migrationHead", "migrationCount", "journalFormatVersion", "journalPath", "historyDigest", "upgradePolicy", "state"]);
exactKeys("compatibility.mcp", compatibility.mcp, ["state", "transport", "protocolVersions", "toolset", "tools"]);
exactKeys("compatibility.mcp.toolset", compatibility.mcp?.toolset, ["id", "version", "maximumTools"]);
exactKeys("compatibility.transition", compatibility.transition, ["legacyLast30days", "nonV1Capabilities", "mcp", "productionSourceRegistry", "decisionBriefV2"]);
exactKeys("baseline.legacyLast30days", baseline.legacyLast30days, ["gitlinkRevision", "localCheckout", "ciFetchesSubmodules", "dockerShipsPython", "dockerCopiesVendor", "workerStillSubscribes", "directReferenceFileCount", "criticalDependency"]);
exactKeys("baseline.legacySchema", baseline.legacySchema, ["tables", "enums", "identityBearingFields", "providerShapedOrFreeTextFields", "historicalMigrations", "migrationRule"]);
exactKeys("baseline.r0Subgates", baseline.r0Subgates, ["repositoryBaseline", "installationPreflight"]);
const transitionEnums = {
  legacyLast30days: ["pending_removal", "removed"],
  nonV1Capabilities: ["implemented_unsupported", "parked", "removed"],
  mcp: ["not_implemented", "implemented"],
  productionSourceRegistry: ["empty", "live"],
  decisionBriefV2: ["not_implemented", "implemented"],
};
for (const [key, allowed] of Object.entries(transitionEnums)) if (!allowed.includes(compatibility.transition?.[key])) fail(`Unknown transition.${key} value ${String(compatibility.transition?.[key])}.`);

if (compatibility.manifestSchemaVersion !== 1 || capabilities.schemaVersion !== 1 || decisions.schemaVersion !== 1 || baseline.schemaVersion !== 1) {
  fail("All product governance documents must use schema version 1.");
}
if (compatibility.product?.id !== packageJson.name || compatibility.product?.releaseVersion !== packageJson.version) {
  fail("Compatibility product id/release version must match package.json.");
}
if (compatibility.product?.generation !== "v1" || compatibility.product?.releaseVersionSource !== "package.json#/version" || compatibility.product?.buildRevisionSource !== "env:APPLICATION_VERSION") {
  fail("Product generation and build revision source must remain explicit and separate.");
}
if (decisions.product !== compatibility.product?.id) fail("Decision register product does not match compatibility manifest.");
if (compatibility.blueprint?.path !== "BLUEPRINT.md" || compatibility.roadmap?.path !== "ROADMAP.md") fail("Canonical Blueprint/Roadmap paths drifted.");
if (!allowedReleaseStates.includes(compatibility.core?.state)) fail(`Unknown Core state ${String(compatibility.core?.state)}.`);
if (compatibility.core?.version !== null && !semver.test(compatibility.core.version)) fail("Non-null Core version must be SemVer.");
if (compatibility.database?.engine !== "postgresql" || compatibility.database?.journalPath !== "drizzle/meta/_journal.json" || compatibility.database?.upgradePolicy !== "forward-only") fail("Database engine, journal path and forward-only policy are fixed v1 boundaries.");

const blueprintVersion = blueprint.match(/^\| Blueprint version \|\s*([^|\n]+)\s*\|$/m)?.[1]?.trim();
if (!blueprintVersion) fail("BLUEPRINT.md has no version row.");
for (const [label, version] of [
  ["compatibility blueprint", compatibility.blueprint?.version],
  ["compatibility roadmap", compatibility.roadmap?.blueprintVersion],
  ["capability register", capabilities.blueprintVersion],
]) if (version !== blueprintVersion) fail(`${label} version ${String(version)} does not match Blueprint ${String(blueprintVersion)}.`);
if (!roadmap.includes(`BLUEPRINT.md\` version ${blueprintVersion}`)) fail("ROADMAP.md does not reference the canonical Blueprint version.");

for (const pointer of [compatibility.capabilityRegister, compatibility.decisionRegister, compatibility.baseline]) {
  requirePath("manifest register path", pointer?.path);
  const target = pointer?.path ? readJson(pointer.path) : {};
  if (target.schemaVersion !== pointer?.schemaVersion) fail(`${String(pointer?.path)} schema version does not match compatibility-manifest.json.`);
}
requirePath("Core source", compatibility.core?.source);

if (!Array.isArray(journal.entries) || journal.entries.length === 0) fail("Drizzle journal must contain migrations.");
const migrationTags = (journal.entries ?? []).map((entry) => entry.tag);
unique("migration tags", migrationTags);
for (const [index, entry] of (journal.entries ?? []).entries()) {
  if (entry.idx !== index + 1) fail(`Migration journal idx must be contiguous from 1; found ${String(entry.idx)} at position ${index + 1}.`);
  if (!entry.tag?.startsWith(String(index + 1).padStart(4, "0") + "_")) fail(`Migration tag ${String(entry.tag)} does not match journal order ${index + 1}.`);
  requirePath(`migration ${entry.tag} snapshot`, `drizzle/meta/${String(index + 1).padStart(4, "0")}_snapshot.json`);
}
const migrationFiles = readdirSync(join(root, "drizzle")).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
sameMembers("migration journal/files", migrationTags.map((tag) => `${tag}.sql`), migrationFiles);
const migrationHead = migrationTags.at(-1);
if (compatibility.database?.migrationHead !== migrationHead || compatibility.database?.schemaVersion !== migrationHead) fail("Compatibility database version must equal the current final migration tag.");
if (compatibility.database?.migrationCount !== migrationTags.length) fail("Database migration count does not match the journal.");
if (compatibility.database?.journalFormatVersion !== journal.version) fail("Drizzle journal format version drifted.");
const history = createHash("sha256");
for (const tag of migrationTags) {
  history.update(tag);
  history.update("\0");
  history.update(readFileSync(join(root, "drizzle", `${tag}.sql`)));
  history.update("\0");
}
if (compatibility.database?.historyDigest !== `sha256:${history.digest("hex")}`) fail("Migration history digest changed; never edit applied migration history.");

const contracts = compatibility.contracts ?? [];
const contractIds = contracts.map((item) => item.wireId);
unique("contract wire IDs", contractIds);
const contractSet = new Set(contractIds);
for (const [index, contract] of contracts.entries()) {
  exactKeys(`contracts[${index}]`, contract, ["id", "wireId", "state", "scope", "schemaPath", "sourcePaths", "compatiblePredecessors", "supersedes"]);
  if (!wireId.test(contract.wireId ?? "")) fail(`Invalid wire contract id ${String(contract.wireId)}.`);
  if (!allowedReleaseStates.includes(contract.state)) fail(`Unknown contract state ${String(contract.state)}.`);
  for (const path of contract.sourcePaths ?? []) requirePath(`${contract.wireId} source`, path);
  if (contract.schemaPath) requirePath(`${contract.wireId} schema`, contract.schemaPath);
  for (const predecessor of contract.compatiblePredecessors ?? []) if (!contractSet.has(predecessor)) fail(`${contract.wireId} has unknown predecessor ${predecessor}.`);
  if (contract.supersedes && !contractSet.has(contract.supersedes)) fail(`${contract.wireId} supersedes unknown contract ${contract.supersedes}.`);
  if (contract.state === "production_supported" && (!contract.schemaPath || !(contract.sourcePaths ?? []).length)) fail(`${contract.wireId} needs a released schema and implementation source before production support.`);
}
for (const contract of contracts) {
  const seen = new Set();
  let cursor = contract;
  while (cursor?.supersedes) {
    if (seen.has(cursor.wireId)) {
      fail(`Contract supersession cycle includes ${contract.wireId}.`);
      break;
    }
    seen.add(cursor.wireId);
    const predecessor = contracts.find((item) => item.wireId === cursor.supersedes);
    if (predecessor?.id !== contract.id) fail(`${contract.wireId} cannot supersede a different contract family.`);
    cursor = predecessor;
  }
}

const abilities = compatibility.abilities ?? [];
const abilityKeys = abilities.map((ability) => `${ability.id}@${ability.version ?? "designed"}`);
unique("ability versions", abilityKeys);
const abilityVersionSet = new Set(abilities.filter((ability) => ability.version).map((ability) => `${ability.id}@${ability.version}`));
for (const [index, ability] of abilities.entries()) {
  exactKeys(`abilities[${index}]`, ability, ["id", "version", "state", "scope", "outputContract", "manifestSource", "evaluationEvidence"]);
  if (!allowedReleaseStates.includes(ability.state)) fail(`${ability.id} has unknown ability state ${String(ability.state)}.`);
  if (ability.version !== null && !semver.test(ability.version)) fail(`${ability.id} version must be SemVer or null while designed.`);
  if (ability.outputContract && !contractSet.has(ability.outputContract)) fail(`${ability.id} references unknown output contract ${ability.outputContract}.`);
  if (ability.manifestSource) requirePath(`${ability.id} manifest source`, ability.manifestSource);
  if (["externally_validated", "production_supported"].includes(ability.state) && !(ability.evaluationEvidence ?? []).length) fail(`${ability.id} needs current human evaluation evidence.`);
  if (ability.state === "production_supported" && (!ability.version || !ability.manifestSource || compatibility.core?.version === null)) fail(`${ability.id} cannot be production_supported without versioned ability/Core manifests.`);
  if (ability.state === "production_supported" && contracts.find((item) => item.wireId === ability.outputContract)?.state !== "production_supported") fail(`${ability.id} cannot be production_supported on non-production output contract ${String(ability.outputContract)}.`);
  if (ability.state === "production_supported") {
    if (ability.scope !== "v1") fail(`${ability.id} production ability must be the v1 ability.`);
    for (const [evidenceIndex, evidence] of (ability.evaluationEvidence ?? []).entries()) verifyDurableEvidence(`${ability.id}.evaluationEvidence[${evidenceIndex}]`, evidence);
  }
}
if (abilities.filter((ability) => ability.state === "production_supported").length > 1) fail("At most one ability may be production_supported in v1.");
if (abilities.filter((ability) => ability.scope === "v1").length !== 1) fail("Exactly one v1 ability must be declared.");
if (abilities.some((ability) => ability.scope === "v1" && ability.outputContract !== "decision-brief@2")) fail("The v1 ability must use decision-brief@2.");
const abilityCatalogSource = readFileSync(join(root, "src/abilities/catalog.ts"), "utf8");
const catalogAbilities = [...abilityCatalogSource.matchAll(/id: "([a-z][a-z0-9-]+)",\s*\n\s*version: "([^"]+)"/g)].map((match) => `${match[1]}@${match[2]}`);
const manifestedCatalogAbilities = abilities.filter((ability) => ability.manifestSource === "src/abilities/catalog.ts").map((ability) => `${ability.id}@${ability.version}`);
sameMembers("implemented ability catalog", manifestedCatalogAbilities, catalogAbilities);
const catalogContractByAbility = new Map([...abilityCatalogSource.matchAll(/id: "([a-z][a-z0-9-]+)",\s*\n\s*version: "([^"]+)"[\s\S]*?outputContract: "([^"]+)"/g)].map((match) => [`${match[1]}@${match[2]}`, match[3]]));
for (const ability of abilities.filter((item) => item.manifestSource === "src/abilities/catalog.ts")) {
  if (ability.outputContract !== catalogContractByAbility.get(`${ability.id}@${ability.version}`)) fail(`${ability.id}@${ability.version} output contract drifted from the runtime catalog.`);
}

const tools = compatibility.mcp?.tools ?? [];
const expectedTools = [
  { name: "research_competitor_positioning", actionClass: "compute", requiredScopes: ["mr:research:run"], requiredRoles: ["owner", "admin", "researcher"], idempotency: "required", capabilityId: "competitor-positioning-research", outputContract: "decision-brief@2" },
  { name: "get_research_brief", actionClass: "read", requiredScopes: ["mr:research:read"], requiredRoles: ["owner", "admin", "researcher", "reviewer", "viewer"], idempotency: "not_applicable", capabilityId: "research-artifacts", outputContract: "decision-brief@2" },
  { name: "get_market_context", actionClass: "read", requiredScopes: ["mr:context:read"], requiredRoles: ["owner", "admin", "researcher", "reviewer", "viewer"], idempotency: "not_applicable", capabilityId: "company-context", outputContract: "company-context@1" },
  { name: "review_research_brief", actionClass: "review_write", requiredScopes: ["mr:research:review"], requiredRoles: ["owner", "admin", "reviewer"], idempotency: "required", capabilityId: "research-review", outputContract: "decision-brief@2" },
];
if (JSON.stringify(tools.map((tool) => tool.name)) !== JSON.stringify(expectedTools.map((tool) => tool.name))) fail("MCP tool order/names must match the four canonical Blueprint tools.");
unique("MCP tool names", tools.map((tool) => tool.name));
if (tools.length > compatibility.mcp?.toolset?.maximumTools || compatibility.mcp?.toolset?.maximumTools > 6) fail("MCP tool count exceeds the Blueprint overbuild budget.");
for (const [index, tool] of tools.entries()) {
  exactKeys(`mcp.tools[${index}]`, tool, ["name", "state", "inputContract", "outputContract", "actionClass", "requiredScopes", "requiredRoles", "idempotency", "capabilityId"]);
  if (tool.outputContract && !contractSet.has(tool.outputContract)) fail(`${tool.name} references unknown output contract ${tool.outputContract}.`);
  if (!allowedReleaseStates.includes(tool.state)) fail(`${tool.name} has unknown tool state ${String(tool.state)}.`);
  if (!['read', 'compute', 'review_write'].includes(tool.actionClass)) fail(`${tool.name} has an unsupported action class.`);
  if (!['required', 'not_applicable'].includes(tool.idempotency)) fail(`${tool.name} has an invalid idempotency rule.`);
  const expected = expectedTools[index];
  for (const field of ["actionClass", "idempotency", "capabilityId", "outputContract"]) if (tool[field] !== expected[field]) fail(`${tool.name} ${field} drifted from the approved authorization table.`);
  for (const field of ["requiredScopes", "requiredRoles"]) if (JSON.stringify(tool[field]) !== JSON.stringify(expected[field])) fail(`${tool.name} ${field} drifted from the approved authorization table.`);
  if (tool.state === "production_supported" && (!tool.inputContract || !tool.outputContract || compatibility.mcp?.state !== "production_supported")) fail(`${tool.name} needs versioned input/output contracts and production MCP before production support.`);
  if (tool.state === "production_supported") {
    for (const contractId of [tool.inputContract, tool.outputContract]) if (contracts.find((contract) => contract.wireId === contractId)?.state !== "production_supported") fail(`${tool.name} requires production-supported contract ${String(contractId)}.`);
    if ((capabilities.capabilities ?? []).find((capability) => capability.id === tool.capabilityId)?.releaseState !== "production_supported") fail(`${tool.name} requires production-supported capability ${tool.capabilityId}.`);
  }
}
if (compatibility.mcp?.toolset?.version !== null && !semver.test(compatibility.mcp.toolset.version)) fail("Non-null MCP toolset version must be SemVer.");
if (!allowedReleaseStates.includes(compatibility.mcp?.state)) fail(`Unknown MCP state ${String(compatibility.mcp?.state)}.`);
if (compatibility.transition?.mcp === "not_implemented" && compatibility.mcp?.state !== "designed") fail("transition.mcp=not_implemented requires designed MCP state.");
if (compatibility.transition?.mcp === "implemented" && compatibility.mcp?.state === "designed") fail("transition.mcp=implemented cannot retain designed MCP state.");
if (compatibility.mcp?.state === "production_supported") {
  if (!compatibility.mcp.toolset?.version || !(compatibility.mcp.protocolVersions ?? []).length || tools.some((tool) => tool.state !== "production_supported") || !(compatibility.hosts ?? []).some((host) => host.state === "production_supported") || compatibility.core?.state !== "production_supported") fail("Production MCP requires production Core, a versioned toolset, protocol version, production-supported tools and host.");
}
unique("host ids", (compatibility.hosts ?? []).map((host) => host.id));
for (const [index, host] of (compatibility.hosts ?? []).entries()) {
  exactKeys(`hosts[${index}]`, host, ["id", "state", "package", "conformanceEvidence", "limitations"]);
  exactKeys(`hosts[${index}].package`, host.package, ["id", "version", "path"]);
  if (!allowedReleaseStates.includes(host.state)) fail(`${host.id} has unknown host state.`);
  if (host.package?.path) requirePath(`${host.id} package`, host.package.path);
  if (host.state === "production_supported") {
    if (!host.package?.id || !host.package?.path || !semver.test(host.package?.version ?? "") || !(host.conformanceEvidence ?? []).length || compatibility.mcp?.state !== "production_supported") fail("A production-supported host requires production MCP, a named/versioned package path and current conformance evidence.");
    for (const [evidenceIndex, evidence] of (host.conformanceEvidence ?? []).entries()) verifyDurableEvidence(`${host.id}.conformanceEvidence[${evidenceIndex}]`, evidence);
  }
}
if ((compatibility.sourcePaths ?? []).length !== 3) fail("Exactly three v1 source paths must be declared.");
unique("source path ids", (compatibility.sourcePaths ?? []).map((source) => source.id));
if (JSON.stringify((compatibility.sourcePaths ?? []).map((source) => source.id)) !== JSON.stringify(["client-documents", "trusted-web", "licensed-listening"])) fail("The three v1 source path IDs/order drifted.");
for (const [index, source] of (compatibility.sourcePaths ?? []).entries()) {
  exactKeys(`sourcePaths[${index}]`, source, ["id", "state", "productionAdapters"]);
  if (!allowedReleaseStates.includes(source.state)) fail(`${source.id} has unknown source-path state ${String(source.state)}.`);
  if (source.state === "production_supported" && (!(source.productionAdapters ?? []).length || compatibility.transition?.productionSourceRegistry !== "live")) fail(`${source.id} production support requires at least one live registry-backed adapter.`);
}
if ((baseline.productionSourceAdapters ?? []).length) fail("The baseline cannot claim production source adapters while the production registry is empty.");

if (capabilities.product !== compatibility.product?.id) fail("Capability register product does not match compatibility manifest.");
if (JSON.stringify(capabilities.classifications) !== JSON.stringify(allowedClassifications)) fail("Capability classification vocabulary drifted.");
if (JSON.stringify(capabilities.releaseStates) !== JSON.stringify(allowedReleaseStates)) fail("Capability release-state vocabulary drifted.");
const capabilityItems = capabilities.capabilities ?? [];
const capabilityIds = capabilityItems.map((item) => item.id);
unique("capability ids", capabilityIds);
const capabilityById = new Map(capabilityItems.map((item) => [item.id, item]));
const toolSet = new Set(tools.map((tool) => tool.name));
const sourcePathSet = new Set((compatibility.sourcePaths ?? []).map((source) => source.id));
const currentSchemaSource = readFileSync(join(root, "src/db/schema.ts"), "utf8");
const currentTableSet = new Set([...currentSchemaSource.matchAll(/^export const [A-Za-z0-9]+ = pgTable\("([^"]+)"/gm)].map((match) => match[1]));
const currentWorkerSource = readdirSync(join(root, "src/workers")).filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts")).map((path) => readFileSync(join(root, "src/workers", path), "utf8")).join("\n");
const capabilityKeys = ["id", "classification", "layer", "purpose", "nonPurpose", "owner", "releaseState", "versions", "dataClasses", "sourcePaths", "dependencies", "humanGates", "evaluationSuite", "evidenceReferences", "supportedHosts", "operationalRequirements", "removalCondition", "limitations", "inventory"];
for (const [index, capability] of capabilityItems.entries()) {
  exactKeys(`capabilities[${index}]`, capability, capabilityKeys);
  exactKeys(`${capability.id}.versions`, capability.versions, ["contracts", "abilities", "tools"]);
  exactKeys(`${capability.id}.inventory`, capability.inventory, ["paths", "routes", "tables", "queues"]);
  if (!/^[a-z][a-z0-9-]+$/.test(capability.id ?? "")) fail(`Invalid capability id ${String(capability.id)}.`);
  if (!allowedClassifications.includes(capability.classification)) fail(`${capability.id} has unknown classification.`);
  if (!allowedReleaseStates.includes(capability.releaseState)) fail(`${capability.id} has unknown release state.`);
  if (!allowedLayers.includes(capability.layer)) fail(`${capability.id} has unknown layer.`);
  if (typeof capability.owner !== "string" || !capability.owner) fail(`${capability.id} needs an accountable owner role.`);
  for (const dataClass of capability.dataClasses ?? []) if (!allowedDataClasses.includes(dataClass)) fail(`${capability.id} has unknown data class ${dataClass}.`);
  for (const gate of capability.humanGates ?? []) if (!allowedHumanGates.includes(gate)) fail(`${capability.id} has unknown human gate ${gate}.`);
  for (const dependency of capability.dependencies ?? []) if (!capabilityById.has(dependency)) fail(`${capability.id} depends on unknown capability ${dependency}.`);
  for (const contract of capability.versions?.contracts ?? []) if (!contractSet.has(contract)) fail(`${capability.id} references unknown contract ${contract}.`);
  for (const ability of capability.versions?.abilities ?? []) if (!abilityVersionSet.has(ability)) fail(`${capability.id} references unknown ability ${ability}.`);
  for (const tool of capability.versions?.tools ?? []) if (!toolSet.has(tool)) fail(`${capability.id} references unknown MCP tool ${tool}.`);
  for (const sourcePath of capability.sourcePaths ?? []) if (!sourcePathSet.has(sourcePath)) fail(`${capability.id} references unknown source path ${sourcePath}.`);
  for (const [evidenceIndex, evidence] of (capability.evidenceReferences ?? []).entries()) {
    allowedKeys(`${capability.id}.evidenceReferences[${evidenceIndex}]`, evidence, ["kind", "status", "ref", "digest", "verifiedAt", "expiresAt"]);
    for (const required of ["kind", "status", "ref"]) if (!(required in evidence)) fail(`${capability.id}.evidenceReferences[${evidenceIndex}] is missing field ${required}.`);
    if (!["automated_test", "document", "external_validation", "operation", "repository_audit"].includes(evidence.kind)) fail(`${capability.id} has unknown evidence kind ${String(evidence.kind)}.`);
    if (!["verified", "needs_context"].includes(evidence.status)) fail(`${capability.id} has unknown evidence status ${String(evidence.status)}.`);
    requirePath(`${capability.id} evidence reference`, evidence.ref);
  }
  for (const path of capability.inventory?.paths ?? []) if (capability.releaseState !== "removed") requirePath(`${capability.id} inventory path`, path);
  for (const route of capability.inventory?.routes ?? []) {
    if (capability.releaseState !== "removed") requirePath(`${capability.id} inventory route`, route);
    if (!route.endsWith("/route.ts")) fail(`${capability.id} inventory route must name an exact route.ts file: ${route}.`);
  }
  if (capability.releaseState !== "removed") {
    for (const table of capability.inventory?.tables ?? []) if (!currentTableSet.has(table)) fail(`${capability.id} inventory references unknown current table ${table}.`);
    for (const queue of capability.inventory?.queues ?? []) if (!currentWorkerSource.includes(`"${queue}"`)) fail(`${capability.id} inventory references unknown current queue ${queue}.`);
  }
  if (["v1", "supporting"].includes(capability.classification)) {
    for (const dependency of capability.dependencies ?? []) {
      const dependencyClass = capabilityById.get(dependency)?.classification;
      if (["parked", "remove"].includes(dependencyClass)) fail(`${capability.id} cannot depend on ${dependencyClass} capability ${dependency}.`);
      const dependencyState = capabilityById.get(dependency)?.releaseState;
      if (capability.releaseState in activeStateRank && dependencyState in activeStateRank && activeStateRank[dependencyState] < activeStateRank[capability.releaseState]) fail(`${capability.id} cannot be ${capability.releaseState} while dependency ${dependency} is only ${dependencyState}.`);
    }
  }
  if (capability.layer === "core") {
    for (const dependency of capability.dependencies ?? []) {
      if (capabilityById.get(dependency)?.layer !== "core") fail(`Core capability ${capability.id} cannot depend on non-Core capability ${dependency}.`);
    }
  }
  if (capability.releaseState === "production_supported") {
    if (!(capability.supportedHosts ?? []).length) fail(`${capability.id} cannot be production_supported without a supported host.`);
    const kinds = new Set((capability.evidenceReferences ?? []).filter((item) => item.status === "verified").map((item) => item.kind));
    for (const kind of ["external_validation", "operation"]) if (!kinds.has(kind)) fail(`${capability.id} lacks verified ${kind} evidence.`);
    for (const evidence of (capability.evidenceReferences ?? []).filter((item) => item.status === "verified" && ["external_validation", "operation"].includes(item.kind))) {
      verifyDurableEvidence(`${capability.id} production evidence`, { ref: evidence.ref, digest: evidence.digest, verifiedAt: evidence.verifiedAt, expiresAt: evidence.expiresAt });
    }
    for (const hostId of capability.supportedHosts ?? []) if (!(compatibility.hosts ?? []).some((host) => host.id === hostId && host.state === "production_supported")) fail(`${capability.id} references a host that is not production_supported: ${hostId}.`);
    for (const dependencyId of capability.dependencies ?? []) if (capabilityById.get(dependencyId)?.releaseState !== "production_supported") fail(`${capability.id} relies on non-production capability ${dependencyId}.`);
    for (const sourcePathId of capability.sourcePaths ?? []) if (compatibility.sourcePaths.find((item) => item.id === sourcePathId)?.state !== "production_supported") fail(`${capability.id} relies on non-production source path ${sourcePathId}.`);
    for (const contractId of capability.versions?.contracts ?? []) if (contracts.find((item) => item.wireId === contractId)?.state !== "production_supported") fail(`${capability.id} relies on non-production contract ${contractId}.`);
    for (const abilityId of capability.versions?.abilities ?? []) if (abilities.find((item) => `${item.id}@${item.version}` === abilityId)?.state !== "production_supported") fail(`${capability.id} relies on non-production ability ${abilityId}.`);
    for (const toolName of capability.versions?.tools ?? []) if (tools.find((item) => item.name === toolName)?.state !== "production_supported") fail(`${capability.id} relies on non-production tool ${toolName}.`);
    if (capability.classification === "v1" && capabilityById.get("deployment-isolation")?.releaseState !== "production_supported") fail(`${capability.id} cannot be production_supported before deployment-isolation.`);
  }
}
const decisionBriefV2 = contracts.find((contract) => contract.wireId === "decision-brief@2");
if (compatibility.transition?.decisionBriefV2 === "not_implemented" && decisionBriefV2?.state !== "designed") fail("decisionBriefV2 transition must match the designed contract state.");
if (compatibility.transition?.decisionBriefV2 === "implemented" && decisionBriefV2?.state === "designed") fail("decisionBriefV2 transition says implemented while the contract is only designed.");
for (const tool of tools) if (!capabilityById.has(tool.capabilityId)) fail(`${tool.name} references unknown capability ${tool.capabilityId}.`);
const inventoriedRoutes = new Set(capabilityItems.flatMap((item) => item.inventory?.routes ?? []));
for (const route of baseline.routeHandlers ?? []) if (!inventoriedRoutes.has(route)) fail(`Frozen route is not assigned to a capability inventory: ${route}.`);
const inventoriedPaths = capabilityItems.flatMap((item) => item.inventory?.paths ?? []);
for (const page of baseline.pageRoutes ?? []) if (!inventoriedPaths.some((path) => page === path || page.startsWith(`${path}/`))) fail(`Frozen page is not assigned to a capability inventory: ${page}.`);
const abilityManifestRemovalOwners = capabilityItems.filter((item) => item.classification === "remove" && (item.inventory?.tables ?? []).includes("ability_manifest"));
if (abilityManifestRemovalOwners.length !== 1 || abilityManifestRemovalOwners[0].id !== "database-ability-manifests") fail("database-ability-manifests must be the sole destructive owner of ability_manifest.");

const visiting = new Set();
const visited = new Set();
function visitCapability(id, path = []) {
  if (visiting.has(id)) return fail(`Capability dependency cycle: ${[...path, id].join(" -> ")}.`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of capabilityById.get(id)?.dependencies ?? []) visitCapability(dependency, [...path, id]);
  visiting.delete(id);
  visited.add(id);
}
for (const id of capabilityIds) visitCapability(id);

const decisionItems = decisions.decisions ?? [];
unique("decision ids", decisionItems.map((item) => item.id));
const ownerAssignments = decisions.ownerAssignments ?? [];
unique("decision owner assignment roles", ownerAssignments.map((item) => item.role));
for (const [index, assignment] of ownerAssignments.entries()) {
  exactKeys(`ownerAssignments[${index}]`, assignment, ["role", "status", "acceptedBy", "acceptedAt", "acceptanceEvidence"]);
  if (!["pending", "accepted"].includes(assignment.status)) fail(`${assignment.role} has invalid owner-assignment status.`);
  if (assignment.status === "accepted") {
    if (!assignment.acceptedBy || !assignment.acceptedAt || !assignment.acceptanceEvidence) fail(`${assignment.role} acceptance requires an accountable person, timestamp and durable evidence.`);
    else verifyDurableEvidence(`${assignment.role}.acceptanceEvidence`, assignment.acceptanceEvidence);
  }
}
sameMembers("decision owners/assignments", [...new Set(decisionItems.map((item) => item.owner))], ownerAssignments.map((item) => item.role));
for (const [index, decision] of decisionItems.entries()) {
  exactKeys(`decisions[${index}]`, decision, ["id", "question", "status", "proposal", "owner", "requiredBefore", "blocker", "decisionEvidence"]);
  if (!['proposed', 'needs_context', 'decided', 'superseded'].includes(decision.status)) fail(`${decision.id} has unknown status.`);
  if (!/^(?:R0[AB]|R1A1|R1A1b|R1A2|R1B|R[2-7])$/.test(decision.requiredBefore ?? "")) fail(`${decision.id} has invalid requiredBefore gate.`);
  if (!decision.owner || !decision.blocker) fail(`${decision.id} needs an owner role and explicit blocker.`);
  if (decision.status === "proposed" && !decision.proposal) fail(`${decision.id} proposal status requires a proposal.`);
  if (decision.status === "decided") {
    if (!decision.decisionEvidence) fail(`${decision.id} decided status requires durable evidence.`);
    else verifyDurableEvidence(`${decision.id}.decisionEvidence`, decision.decisionEvidence);
  }
}

unique("baseline route handlers", baseline.routeHandlers);
unique("baseline page routes", baseline.pageRoutes);
unique("baseline queues", baseline.queues);
unique("baseline schema tables", baseline.schemaTables);
unique("baseline verification ids", (baseline.verification ?? []).map((item) => item.id));
for (const [index, item] of (baseline.verification ?? []).entries()) {
  exactKeys(`baseline.verification[${index}]`, item, ["id", "status", "evidence"]);
  if (!["passed", "needs_context", "failed"].includes(item.status)) fail(`${item.id} has invalid verification status.`);
  if (!item.evidence) fail(`${item.id} needs an evidence statement.`);
}
for (const blocker of baseline.openBlockers ?? []) if (!(baseline.verification ?? []).some((item) => item.id === blocker && item.status !== "passed")) fail(`R0 blocker ${blocker} must resolve to an incomplete verification item.`);
for (const [subgate, status] of Object.entries(baseline.r0Subgates ?? {})) if (!["open", "passed"].includes(status)) fail(`R0 subgate ${subgate} has invalid status ${String(status)}.`);
if (baseline.r0Subgates?.repositoryBaseline === "passed" && (baseline.verification ?? []).find((item) => item.id === "remote-baseline-governance")?.status !== "passed") fail("R0A repository baseline requires a passed remote-baseline-governance check.");
for (const path of baseline.legacySchema?.historicalMigrations ?? []) requirePath("legacy historical migration", path);
if (!/^[0-9a-f]{40}$/.test(baseline.baselineCommit ?? "")) fail("Baseline commit must be a full Git SHA.");
const tagTarget = git(["rev-parse", `${baseline.preTrimTag}^{}`]);
if (tagTarget !== baseline.baselineCommit) fail(`Annotated tag ${baseline.preTrimTag} must resolve to baseline commit ${baseline.baselineCommit}.`);
if (git(["cat-file", "-t", baseline.preTrimTag]) !== "tag") fail(`${baseline.preTrimTag} must be an annotated tag.`);
const baselineTree = git(["ls-tree", "-r", "--name-only", baseline.baselineCommit]).split("\n").filter(Boolean);
sameMembers("frozen route-handler inventory", baseline.routeHandlers ?? [], baselineTree.filter((path) => path.startsWith("app/") && path.endsWith("/route.ts")));
sameMembers("frozen page route inventory", baseline.pageRoutes ?? [], baselineTree.filter((path) => path.startsWith("app/") && path.endsWith("/page.tsx")));
const baselineSchemaSource = git(["show", `${baseline.baselineCommit}:src/db/schema.ts`]);
const baselineTables = [...baselineSchemaSource.matchAll(/^export const [A-Za-z0-9]+ = pgTable\("([^"]+)"/gm)].map((match) => match[1]);
sameMembers("frozen database table inventory", baseline.schemaTables ?? [], baselineTables);
const baselineWorkerPaths = baselineTree.filter((path) => path.startsWith("src/workers/") && path.endsWith(".ts") && !path.endsWith(".test.ts"));
const baselineWorkerSource = baselineWorkerPaths.map((path) => git(["show", `${baseline.baselineCommit}:${path}`])).join("\n");
for (const queue of baseline.queues ?? []) if (!baselineWorkerSource.includes(`"${queue}"`)) fail(`Frozen baseline queue ${queue} is absent at ${baseline.baselineCommit}.`);
const baselineJournal = JSON.parse(git(["show", `${baseline.baselineCommit}:drizzle/meta/_journal.json`]));
if (baselineJournal.entries?.at(-1)?.tag !== baseline.migrationHead) fail("Frozen baseline migration head does not match the tagged commit.");
const baselineHistory = createHash("sha256");
for (const entry of baselineJournal.entries ?? []) {
  baselineHistory.update(entry.tag);
  baselineHistory.update("\0");
  baselineHistory.update(gitRaw(["show", `${baseline.baselineCommit}:drizzle/${entry.tag}.sql`]));
  baselineHistory.update("\0");
}
if (baseline.migrationHistoryDigest !== `sha256:${baselineHistory.digest("hex")}`) fail("Frozen baseline migration history digest does not match the tagged commit.");
const baselineTags = (baselineJournal.entries ?? []).map((entry) => entry.tag);
if (JSON.stringify(migrationTags.slice(0, baselineTags.length)) !== JSON.stringify(baselineTags)) fail("Current migration journal must preserve the exact tagged baseline prefix and may only append.");
const currentBaselinePrefix = createHash("sha256");
for (const tag of baselineTags) {
  currentBaselinePrefix.update(tag);
  currentBaselinePrefix.update("\0");
  currentBaselinePrefix.update(readFileSync(join(root, "drizzle", `${tag}.sql`)));
  currentBaselinePrefix.update("\0");
}
if (baseline.migrationHistoryDigest !== `sha256:${currentBaselinePrefix.digest("hex")}`) fail("Current copies of tagged migrations changed; append a new migration instead.");

if (compatibility.transition?.legacyLast30days === "pending_removal") {
  for (const path of [".gitmodules", "vendor/last30days", "src/workers/runLast30Days.ts", "src/workers/runQueue.ts", "scripts/smoke-last30days.ts"]) requirePath("pending last30days surface", path);
  if (!readFileSync(join(root, "src/lib/featureFlags.ts"), "utf8").includes("return false")) fail("Pending legacy last30days must remain permanently fail-closed.");
} else if (compatibility.transition?.legacyLast30days === "removed") {
  for (const path of [".gitmodules", "vendor/last30days", "src/workers/runLast30Days.ts", "src/workers/runQueue.ts", "scripts/smoke-last30days.ts"]) if (existsSync(join(root, path))) fail(`Removed last30days surface still exists: ${path}.`);
}
if (compatibility.transition?.productionSourceRegistry === "empty") {
  const registry = readFileSync(join(root, "src/evidence/productionRegistry.ts"), "utf8");
  const declared = registry.match(/PRODUCTION_ADAPTER_IDS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/)?.[1]?.trim();
  if (declared === undefined) fail("Production adapter activation must expose PRODUCTION_ADAPTER_IDS.");
  if (declared) fail("Transition says the production registry is empty, but PRODUCTION_ADAPTER_IDS is nonempty.");
  if ((compatibility.sourcePaths ?? []).some((source) => (source.productionAdapters ?? []).length)) fail("Manifest claims a production adapter while transition state says registry is empty.");
}
const registrySource = readFileSync(join(root, "src/evidence/productionRegistry.ts"), "utf8");
const registryLiteral = registrySource.match(/PRODUCTION_ADAPTER_IDS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/)?.[1];
const registryIds = [...(registryLiteral ?? "").matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
const manifestedAdapterIds = (compatibility.sourcePaths ?? []).flatMap((source) => source.productionAdapters ?? []);
sameMembers("production adapter registry/manifest", registryIds, manifestedAdapterIds);
if (compatibility.transition?.productionSourceRegistry === "live" && registryIds.length === 0) fail("A live production source registry must contain at least one adapter.");

const r0aChecks = ["source-of-truth", "lint", "typecheck", "unit-tests", "production-build", "empty-database-and-http-integration", "remote-baseline-governance"];
const r0bChecks = ["representative-upgrade", "backup-restore", "production-database-inventory", "decision-owner-acceptance"];
const verificationById = new Map((baseline.verification ?? []).map((item) => [item.id, item]));
for (const id of [...r0aChecks, ...r0bChecks]) if (!verificationById.has(id)) fail(`R0 verification is missing required check ${id}.`);
const incompleteR0 = [...r0aChecks, ...r0bChecks].filter((id) => verificationById.get(id)?.status !== "passed");
sameMembers("R0 open blockers", incompleteR0, baseline.openBlockers ?? []);
const r0aPassed = r0aChecks.every((id) => verificationById.get(id)?.status === "passed");
const ownersAccepted = ownerAssignments.every((item) => item.status === "accepted");
const r0bPassed = r0aPassed && r0bChecks.every((id) => verificationById.get(id)?.status === "passed") && ownersAccepted;
if ((baseline.r0Subgates?.repositoryBaseline === "passed") !== r0aPassed) fail("R0A subgate status must exactly match its required verification set.");
if ((baseline.r0Subgates?.installationPreflight === "passed") !== r0bPassed) fail("R0B subgate status must exactly match R0A, external checks and owner acceptance.");
if ((verificationById.get("decision-owner-acceptance")?.status === "passed") !== ownersAccepted) fail("decision-owner-acceptance verification must exactly match ownerAssignments.");
if ((baseline.r0GateStatus === "passed") !== (r0aPassed && r0bPassed)) fail("Overall R0 status must exactly match R0A and R0B.");

if (failures.length) {
  for (const failure of failures) console.error(`product-governance: ${failure}`);
  process.exit(1);
}

console.log(`product-governance: OK (${capabilityItems.length} capabilities, ${decisionItems.length} decisions, ${migrationTags.length} migrations, R0 ${baseline.r0GateStatus})`);
