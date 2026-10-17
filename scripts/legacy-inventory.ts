import { createHash } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Client, type QueryResultRow } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { validateClientOwnedDeployment } from "../src/lib/deploymentScope.ts";

const REQUIRED_LEGACY_TABLES = [
  "market", "brand", "brand_market", "research_instruction", "channel", "insight_route",
  "research_run", "evidence", "insight", "insight_evidence", "audit_log",
] as const;
const OPTIONAL_LEGACY_TABLES = ["ability_manifest"] as const;
const LEGACY_TABLES = [...REQUIRED_LEGACY_TABLES, ...OPTIONAL_LEGACY_TABLES] as const;

const JOB_STATES = ["created", "retry", "active", "completed", "cancelled", "failed"] as const;

type MigrationIdentity = { tag: string; createdAt: number; hash: string };
type AppliedMigration = { createdAt: number; hash: string };
type CatalogAbility = { id: string; version: string | null; scope: string; state: string };
type StoredAbilityManifest = { client_id: number | null; ability_key: string; version: string; status: string; manifest_json: unknown };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
/** Stable JSON used by both the artifact checksum and redacted manifest digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("legacy-inventory-non-finite-number");
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object).sort().map((key) => {
      if (object[key] === undefined) throw new Error("legacy-inventory-undefined-value");
      return `${JSON.stringify(key)}:${canonicalJson(object[key])}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new Error("legacy-inventory-non-json-value");
}
export function checksummedArtifact<T extends Record<string, unknown>>(payload: T): T & {
  checksum: { algorithm: "sha256"; canonicalization: "recursive-key-sort-json-utf8-v1"; digest: string };
} {
  return {
    ...payload,
    checksum: {
      algorithm: "sha256",
      canonicalization: "recursive-key-sort-json-utf8-v1",
      digest: sha256(canonicalJson(payload)),
    },
  };
}

/** Verifies artifact integrity only. A SHA-256 checksum does not authenticate its origin. */
export function verifyArtifactIntegrity(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  const checksum = artifact.checksum;
  if (!checksum || typeof checksum !== "object" || Array.isArray(checksum)) return false;
  const metadata = checksum as Record<string, unknown>;
  if (metadata.algorithm !== "sha256" || metadata.canonicalization !== "recursive-key-sort-json-utf8-v1"
    || typeof metadata.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(metadata.digest)) return false;
  const payload = { ...artifact };
  delete payload.checksum;
  try {
    return metadata.digest === sha256(canonicalJson(payload));
  } catch {
    return false;
  }
}

export function classifyMigrations(expected: readonly MigrationIdentity[], applied: readonly AppliedMigration[]) {
  const common = Math.min(expected.length, applied.length);
  const matchesPrefix = Array.from({ length: common }, (_, index) =>
    expected[index].createdAt === applied[index].createdAt && expected[index].hash === applied[index].hash).every(Boolean);
  const state = !applied.length ? "missing"
    : !matchesPrefix ? "diverged"
      : applied.length === expected.length ? "exact"
        : applied.length < expected.length ? "prefix" : "ahead";
  const head = applied.at(-1) ?? null;
  const knownHead = head ? expected.find((item) => item.createdAt === head.createdAt && item.hash === head.hash) : null;
  return {
    state,
    appliedCount: applied.length,
    expectedCount: expected.length,
    expectedHeadTag: expected.at(-1)?.tag ?? null,
    appliedHeadTag: state === "diverged" ? null : knownHead?.tag ?? null,
    appliedHeadHash: head?.hash ?? null,
    appliedHeadCreatedAtEpochMs: head?.createdAt ?? null,
  };
}

export function classifyAbilityRelation(abilityKey: string, version: string, catalog: readonly CatalogAbility[]): "governed_v1_target" | "governed_deferred" | "governed_other" | "unknown_closed" {
  const match = catalog.find((ability) => ability.id === abilityKey && ability.version === version);
  if (!match) return "unknown_closed";
  if (match.scope === "v1") return "governed_v1_target";
  if (match.scope === "deferred") return "governed_deferred";
  return "governed_other";
}

export function projectAbilityManifest(row: StoredAbilityManifest, clientId: number, catalog: readonly CatalogAbility[]) {
  const governed = catalog.find((ability) => ability.id === row.ability_key && ability.version === row.version) ?? null;
  const catalogRelation = classifyAbilityRelation(row.ability_key, row.version, catalog);
  return {
    scope: row.client_id === null ? "global" : row.client_id === clientId ? "tenant" : "foreign",
    storedMetadataDigest: sha256(canonicalJson({ abilityKey: row.ability_key, version: row.version, status: row.status })),
    manifestDigest: sha256(canonicalJson(row.manifest_json)),
    catalogRelation,
    activationStatus: catalogRelation === "governed_v1_target" ? "catalog_match_not_runtime_authority" : "closed",
    governedCatalog: governed ? { id: governed.id, version: governed.version, state: governed.state, scope: governed.scope } : null,
  };
}

export function classifyLegacySchemaPresence(presentRelations: readonly string[]) {
  const present = new Set(presentRelations);
  const required = Object.fromEntries(REQUIRED_LEGACY_TABLES.map((table) => [table, present.has(table)]));
  const optional = Object.fromEntries(OPTIONAL_LEGACY_TABLES.map((table) => [table, present.has(table)]));
  const missingRequired = REQUIRED_LEGACY_TABLES.filter((table) => !present.has(table));
  const missingOptional = OPTIONAL_LEGACY_TABLES.filter((table) => !present.has(table));
  return {
    discoveryState: missingRequired.length ? "failed" as const : "complete" as const,
    required,
    optional,
    missingRequired,
    missingOptional,
    clientRelationPresent: present.has("client"),
  };
}

export function classifyQueueClientScope(value: unknown, clientId: number): "tenant" | "foreign" | "malformed" {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value)
    : typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
  if (normalized === null) return "malformed";
  return normalized === String(clientId) ? "tenant" : "foreign";
}

export function deriveDiscoveryResult(input: {
  missingRequiredRelations: readonly string[];
  clientRelationPresent: boolean;
  clientScopeValidated: boolean;
  queueSchemaState: "absent" | "partial" | "complete";
}) {
  const discoveryFailures = [
    ...(input.missingRequiredRelations.length ? ["missing_required_legacy_relations"] : []),
    ...(!input.clientRelationPresent ? ["missing_client_relation"] : []),
    ...(input.clientRelationPresent && !input.clientScopeValidated ? ["client_scope_not_validated"] : []),
    ...(input.queueSchemaState === "partial" ? ["partial_pgboss_schema"] : []),
  ];
  return {
    discoveryState: discoveryFailures.length === 0 ? "complete" as const : "failed" as const,
    discoveryFailures,
  };
}

export function inventoryExitCode(discoveryState: "complete" | "failed"): 0 | 2 {
  return discoveryState === "complete" ? 0 : 2;
}

export function resolveValidatedClientScope(
  environment: Readonly<Record<string, string | undefined>>,
  rows: readonly { id: number; slug: string }[],
): { id: number; slug: string } | null {
  try {
    validateClientOwnedDeployment(environment, rows);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function count(row: QueryResultRow, key: string): number {
  const parsed = Number(row[key]);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`legacy-inventory-invalid-count:${key}`);
  return parsed;
}

function groupedCounts(rows: QueryResultRow[], key: string, allowed?: readonly string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const value of allowed ?? []) output[value] = 0;
  for (const row of rows) {
    const label = String(row[key]);
    output[allowed && !allowed.includes(label) ? "other" : label] = (output[allowed && !allowed.includes(label) ? "other" : label] ?? 0) + count(row, "row_count");
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}

async function migrationInventory(connection: Client) {
  const expectedFiles = readMigrationFiles({ migrationsFolder: resolve(process.cwd(), "drizzle") });
  const journal = JSON.parse(await readFile(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const expected = journal.entries.map((entry, index) => ({
    tag: entry.tag,
    createdAt: entry.when,
    hash: expectedFiles[index]?.hash ?? "",
  }));
  const exists = await connection.query<{ relation: string | null }>("select to_regclass('drizzle.__drizzle_migrations')::text as relation");
  if (!exists.rows[0]?.relation) return classifyMigrations(expected, []);
  const result = await connection.query<{ hash: string; created_at: string }>(
    "select hash, created_at::text from drizzle.__drizzle_migrations order by created_at, id",
  );
  return classifyMigrations(expected, result.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) })));
}

async function schemaPresenceInventory(connection: Client) {
  const relationNames = ["client", ...LEGACY_TABLES];
  const { rows } = await connection.query<{ relation_name: string }>(`
    select relation.relname relation_name
      from pg_class relation
      join pg_namespace namespace on namespace.oid=relation.relnamespace
     where namespace.nspname='public'
       and relation.relname=any($1::text[])
       and relation.relkind in ('r','p')
     order by relation.relname
  `, [relationNames]);
  return classifyLegacySchemaPresence(rows.map((row) => row.relation_name));
}

async function legacyCounts(connection: Client, clientId: number) {
  const { rows: [row] } = await connection.query(`
    with tenant_markets as (
      select bm.market_id from public.brand_market bm join public.brand b on b.id = bm.brand_id where b.client_id = $1
      union select ri.market_id from public.research_instruction ri join public.brand b on b.id = ri.brand_id where b.client_id = $1 and ri.market_id is not null
      union select rr.market_id from public.research_run rr where rr.client_id = $1 and rr.market_id is not null
      union select i.market_id from public.insight i where i.client_id = $1 and i.market_id is not null
    )
    select
      (select count(*)::text from public.brand) brand_total,
      (select count(*)::text from public.brand where client_id = $1) brand_tenant,
      (select count(*)::text from public.brand_market) brand_market_total,
      (select count(*)::text from public.brand_market bm join public.brand b on b.id = bm.brand_id where b.client_id = $1) brand_market_tenant,
      (select count(*)::text from public.research_instruction) instruction_total,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id = ri.brand_id where b.client_id = $1) instruction_tenant,
      (select count(*)::text from public.research_run) run_total,
      (select count(*)::text from public.research_run where client_id = $1) run_tenant,
      (select count(*)::text from public.evidence) evidence_total,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id = e.run_id where rr.client_id = $1) evidence_tenant,
      (select count(*)::text from public.insight) insight_total,
      (select count(*)::text from public.insight where client_id = $1) insight_tenant,
      (select count(*)::text from public.insight_evidence) insight_evidence_total,
      (select count(*)::text from public.insight_evidence ie join public.insight i on i.id = ie.insight_id where i.client_id = $1) insight_evidence_tenant,
      (select count(*)::text from public.insight_route) route_total,
      (select count(*)::text from public.insight_route ir join public.brand b on b.id = ir.brand_id where b.client_id = $1) route_tenant,
      (select count(*)::text from public.insight_route where brand_id is null) route_unattributed,
      (select count(*)::text from public.channel) channel_total,
      (select count(distinct ir.channel_id)::text from public.insight_route ir join public.brand b on b.id = ir.brand_id where b.client_id = $1) channel_tenant_ref,
      (select count(distinct channel_id)::text from public.insight_route where brand_id is null) channel_unscoped_ref,
      (select count(*)::text from public.channel c where not exists (select 1 from public.insight_route ir where ir.channel_id = c.id)) channel_unreferenced,
      (select count(*)::text from public.channel c where exists (select 1 from public.insight_route ir join public.brand b on b.id = ir.brand_id where ir.channel_id = c.id and b.client_id = $1) and exists (select 1 from public.insight_route ir where ir.channel_id = c.id and ir.brand_id is null)) channel_mixed,
      (select count(*)::text from public.market) market_total,
      (select count(*)::text from tenant_markets) market_tenant_ref,
      (select count(*)::text from public.market m where not exists (select 1 from tenant_markets tm where tm.market_id = m.id)) market_unreferenced,
      (select count(*)::text from public.audit_log) audit_total,
      (select count(*)::text from public.audit_log where before_json is not null) audit_before,
      (select count(*)::text from public.audit_log where after_json is not null) audit_after
  `, [clientId]);
  return {
    brand: { totalRows: count(row, "brand_total"), tenantRows: count(row, "brand_tenant"), foreignRows: count(row, "brand_total") - count(row, "brand_tenant") },
    brand_market: { totalRows: count(row, "brand_market_total"), tenantRows: count(row, "brand_market_tenant"), foreignRows: count(row, "brand_market_total") - count(row, "brand_market_tenant") },
    research_instruction: { totalRows: count(row, "instruction_total"), tenantRows: count(row, "instruction_tenant"), foreignRows: count(row, "instruction_total") - count(row, "instruction_tenant") },
    research_run: { totalRows: count(row, "run_total"), tenantRows: count(row, "run_tenant"), foreignRows: count(row, "run_total") - count(row, "run_tenant") },
    evidence: { totalRows: count(row, "evidence_total"), tenantRows: count(row, "evidence_tenant"), foreignRows: count(row, "evidence_total") - count(row, "evidence_tenant") },
    insight: { totalRows: count(row, "insight_total"), tenantRows: count(row, "insight_tenant"), foreignRows: count(row, "insight_total") - count(row, "insight_tenant") },
    insight_evidence: { totalRows: count(row, "insight_evidence_total"), tenantRows: count(row, "insight_evidence_tenant"), foreignRows: count(row, "insight_evidence_total") - count(row, "insight_evidence_tenant") },
    insight_route: { totalRows: count(row, "route_total"), tenantRows: count(row, "route_tenant"), unattributedRows: count(row, "route_unattributed"), foreignRows: count(row, "route_total") - count(row, "route_tenant") - count(row, "route_unattributed") },
    channel: { totalRows: count(row, "channel_total"), tenantAttribution: "not_provable_from_schema; installation-scoped under supported deployment", referencedByTenantRoutes: count(row, "channel_tenant_ref"), referencedByUnscopedRoutes: count(row, "channel_unscoped_ref"), unreferencedRows: count(row, "channel_unreferenced"), mixedScopeRows: count(row, "channel_mixed") },
    market: { totalRows: count(row, "market_total"), tenantAttribution: "not_provable_from_schema; installation-scoped under supported deployment", referencedByTenantRows: count(row, "market_tenant_ref"), unreferencedRows: count(row, "market_unreferenced") },
    audit_log: { totalRows: count(row, "audit_total"), tenantAttribution: "not_provable_from_schema; installation-scoped under supported deployment", rowsWithBeforeJson: count(row, "audit_before"), rowsWithAfterJson: count(row, "audit_after") },
  };
}

async function abilityManifestCounts(connection: Client, clientId: number) {
  const { rows: [row] } = await connection.query(`
    select count(*)::text manifest_total,
           count(*) filter (where client_id=$1)::text manifest_tenant,
           count(*) filter (where client_id is null)::text manifest_global
      from public.ability_manifest
  `, [clientId]);
  return {
    relationPresent: true,
    totalRows: count(row, "manifest_total"),
    tenantRows: count(row, "manifest_tenant"),
    globalRows: count(row, "manifest_global"),
    foreignRows: count(row, "manifest_total") - count(row, "manifest_tenant") - count(row, "manifest_global"),
  };
}

async function fieldPresence(connection: Client, clientId: number) {
  const { rows: [row] } = await connection.query(`
    select
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and cardinality(ri.subreddits)>0) instruction_subreddits,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and cardinality(ri.dedicated_subreddits)>0) instruction_dedicated_subreddits,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and cardinality(ri.tiktok_hashtags)>0) instruction_tiktok_hashtags,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and nullif(btrim(ri.focus_text),'') is not null) instruction_focus_text,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and nullif(btrim(ri.x_handle),'') is not null) instruction_x_handle,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and cardinality(ri.x_related)>0) instruction_x_related,
      (select count(*)::text from public.research_instruction ri join public.brand b on b.id=ri.brand_id where b.client_id=$1 and cardinality(ri.competitors)>0) instruction_competitors,
      (select count(*)::text from public.channel where nullif(btrim(external_ref),'') is not null) channel_external_ref,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and nullif(btrim(e.external_id),'') is not null) evidence_external_id,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and nullif(btrim(e.url),'') is not null) evidence_url,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and nullif(btrim(e.author_handle),'') is not null) evidence_author_handle,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and nullif(btrim(e.text_snippet),'') is not null) evidence_text_snippet,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and e.engagement_json is not null) evidence_engagement_json,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and e.sensitivity_flag is true) evidence_sensitivity_flag,
      (select count(*)::text from public.evidence e join public.research_run rr on rr.id=e.run_id where rr.client_id=$1 and e.published_at is not null) evidence_published_at,
      (select count(*)::text from public.insight where client_id=$1 and nullif(btrim(title),'') is not null) insight_title,
      (select count(*)::text from public.insight where client_id=$1 and nullif(btrim(summary),'') is not null) insight_summary,
      (select count(*)::text from public.audit_log where before_json is not null) audit_before_json,
      (select count(*)::text from public.audit_log where after_json is not null) audit_after_json
  `, [clientId]);
  const fields: Record<string, string> = {
    "research_instruction.subreddits": "instruction_subreddits",
    "research_instruction.dedicated_subreddits": "instruction_dedicated_subreddits",
    "research_instruction.tiktok_hashtags": "instruction_tiktok_hashtags",
    "research_instruction.focus_text": "instruction_focus_text",
    "research_instruction.x_handle": "instruction_x_handle",
    "research_instruction.x_related": "instruction_x_related",
    "research_instruction.competitors": "instruction_competitors",
    "channel.external_ref": "channel_external_ref",
    "evidence.external_id": "evidence_external_id",
    "evidence.url": "evidence_url",
    "evidence.author_handle": "evidence_author_handle",
    "evidence.text_snippet": "evidence_text_snippet",
    "evidence.engagement_json": "evidence_engagement_json",
    "evidence.sensitivity_flag": "evidence_sensitivity_flag",
    "evidence.published_at": "evidence_published_at",
    "insight.title": "insight_title",
    "insight.summary": "insight_summary",
    "audit_log.before_json": "audit_before_json",
    "audit_log.after_json": "audit_after_json",
  };
  return Object.fromEntries(Object.entries(fields).map(([field, alias]) => [field, count(row, alias)]));
}

async function integrityAnomalies(connection: Client, clientId: number) {
  const { rows: [row] } = await connection.query(`
    select
      (select count(*)::text from public.research_run rr join public.brand b on b.id=rr.brand_id where rr.client_id=$1 and b.client_id<>rr.client_id) run_brand_client_mismatch,
      (select count(*)::text from public.insight i join public.brand b on b.id=i.brand_id where i.client_id=$1 and b.client_id<>i.client_id) insight_brand_client_mismatch,
      (select count(*)::text from public.insight i join public.research_run rr on rr.id=i.run_id where i.client_id=$1 and rr.client_id<>i.client_id) insight_run_client_mismatch,
      (select count(*)::text from public.insight_evidence ie join public.insight i on i.id=ie.insight_id join public.evidence e on e.id=ie.evidence_id join public.research_run rr on rr.id=e.run_id where (i.client_id=$1 or rr.client_id=$1) and i.client_id<>rr.client_id) insight_evidence_client_mismatch,
      (select count(*)::text from public.insight i join public.research_run rr on rr.id=i.run_id where i.client_id=$1 and (i.brand_id<>rr.brand_id or i.market_id is distinct from rr.market_id)) insight_run_scope_mismatch,
      (select count(*)::text from public.insight_evidence ie join public.insight i on i.id=ie.insight_id join public.evidence e on e.id=ie.evidence_id where i.client_id=$1 and i.run_id<>e.run_id) insight_evidence_run_mismatch,
      (select count(*)::text from public.research_run rr left join public.research_instruction ri on ri.brand_id=rr.brand_id and ri.market_id is not distinct from rr.market_id and ri.version=rr.research_instruction_version where rr.client_id=$1 and ri.id is null) run_instruction_version_missing,
      (select count(*)::text from public.brand_market child left join public.brand parent on parent.id=child.brand_id where parent.id is null) brand_market_missing_brand,
      (select count(*)::text from public.research_instruction child left join public.brand parent on parent.id=child.brand_id where parent.id is null) instruction_missing_brand,
      (select count(*)::text from public.research_run child left join public.brand parent on parent.id=child.brand_id where parent.id is null) run_missing_brand,
      (select count(*)::text from public.evidence child left join public.research_run parent on parent.id=child.run_id where parent.id is null) evidence_missing_run,
      (select count(*)::text from public.insight child left join public.brand parent on parent.id=child.brand_id where parent.id is null) insight_missing_brand,
      (select count(*)::text from public.insight child left join public.research_run parent on parent.id=child.run_id where parent.id is null) insight_missing_run,
      (select count(*)::text from public.insight_evidence child left join public.insight parent on parent.id=child.insight_id where parent.id is null) insight_evidence_missing_insight,
      (select count(*)::text from public.insight_evidence child left join public.evidence parent on parent.id=child.evidence_id where parent.id is null) insight_evidence_missing_evidence,
      (select count(*)::text from public.insight_route child left join public.brand parent on parent.id=child.brand_id where child.brand_id is not null and parent.id is null) route_missing_brand,
      (select count(*)::text from public.insight_route child left join public.channel parent on parent.id=child.channel_id where parent.id is null) route_missing_channel
  `, [clientId]);
  return {
    researchRunBrandClientMismatch: count(row, "run_brand_client_mismatch"),
    insightBrandClientMismatch: count(row, "insight_brand_client_mismatch"),
    insightRunClientMismatch: count(row, "insight_run_client_mismatch"),
    insightEvidenceClientMismatch: count(row, "insight_evidence_client_mismatch"),
    insightRunScopeMismatch: count(row, "insight_run_scope_mismatch"),
    insightEvidenceRunMismatch: count(row, "insight_evidence_run_mismatch"),
    researchRunInstructionVersionMissing: count(row, "run_instruction_version_missing"),
    brandMarketMissingBrand: count(row, "brand_market_missing_brand"),
    researchInstructionMissingBrand: count(row, "instruction_missing_brand"),
    researchRunMissingBrand: count(row, "run_missing_brand"),
    evidenceMissingResearchRun: count(row, "evidence_missing_run"),
    insightMissingBrand: count(row, "insight_missing_brand"),
    insightMissingResearchRun: count(row, "insight_missing_run"),
    insightEvidenceMissingInsight: count(row, "insight_evidence_missing_insight"),
    insightEvidenceMissingEvidence: count(row, "insight_evidence_missing_evidence"),
    insightRouteMissingBrand: count(row, "route_missing_brand"),
    insightRouteMissingChannel: count(row, "route_missing_channel"),
  };
}

async function statusCounts(connection: Client, clientId: number) {
  const runs = await connection.query("select status::text label, count(*)::text row_count from public.research_run where client_id=$1 group by status", [clientId]);
  const insightStatuses = await connection.query("select status label, count(*)::text row_count from public.insight where client_id=$1 group by status", [clientId]);
  const deliveryStatuses = await connection.query("select delivery_status::text label, count(*)::text row_count from public.insight where client_id=$1 group by delivery_status", [clientId]);
  const channelTypes = await connection.query("select type::text label, count(*)::text row_count from public.channel group by type");
  const auditTypes = await connection.query("select case when entity_type in ('brand','research_instruction','research_run','insight') then entity_type else 'other' end label, count(*)::text row_count from public.audit_log group by 1");
  return {
    researchRun: groupedCounts(runs.rows, "label", ["queued", "running", "succeeded", "failed", "cancelled"]),
    insight: groupedCounts(insightStatuses.rows, "label", ["pending", "accepted", "discarded"]),
    insightDelivery: groupedCounts(deliveryStatuses.rows, "label", ["not_attempted", "delivered", "failed"]),
    channelType: groupedCounts(channelTypes.rows, "label", ["slack_channel", "drive_folder"]),
    auditEntityType: groupedCounts(auditTypes.rows, "label", ["brand", "research_instruction", "research_run", "insight", "other"]),
  };
}

async function abilityManifests(connection: Client, clientId: number) {
  const catalogDocument = JSON.parse(await readFile(resolve(process.cwd(), "compatibility-manifest.json"), "utf8")) as { abilities?: CatalogAbility[] };
  const { rows } = await connection.query<StoredAbilityManifest>(
    "select client_id, ability_key, version, status, manifest_json from public.ability_manifest order by client_id nulls first, ability_key, version, id",
  );
  return rows.map((row) => projectAbilityManifest(row, clientId, catalogDocument.abilities ?? []));
}

async function databaseDependencies(connection: Client) {
  const foreignKeys = await connection.query<{ name: string; source_schema: string; source_table: string; target_schema: string; target_table: string; definition: string }>(`
    select con.conname name, sns.nspname source_schema, source.relname source_table,
           tns.nspname target_schema, target.relname target_table, pg_get_constraintdef(con.oid, true) definition
      from pg_constraint con
      join pg_class source on source.oid=con.conrelid join pg_namespace sns on sns.oid=source.relnamespace
      join pg_class target on target.oid=con.confrelid join pg_namespace tns on tns.oid=target.relnamespace
     where con.contype='f' and ((sns.nspname='public' and source.relname=any($1::text[])) or (tns.nspname='public' and target.relname=any($1::text[])))
     order by sns.nspname, source.relname, con.conname
  `, [LEGACY_TABLES]);
  const views = await connection.query<{ schema_name: string; object_name: string; object_kind: string; source_table: string }>(`
    select distinct vns.nspname schema_name, view_object.relname object_name,
           case view_object.relkind when 'm' then 'materialized_view' else 'view' end object_kind,
           source.relname source_table
      from pg_depend dependency
      join pg_rewrite rewrite on rewrite.oid=dependency.objid
      join pg_class view_object on view_object.oid=rewrite.ev_class
      join pg_namespace vns on vns.oid=view_object.relnamespace
      join pg_class source on source.oid=dependency.refobjid
      join pg_namespace sns on sns.oid=source.relnamespace
     where sns.nspname='public' and source.relname=any($1::text[]) and view_object.relkind in ('v','m')
     order by vns.nspname, view_object.relname, source.relname
  `, [LEGACY_TABLES]);
  return {
    foreignKeys: foreignKeys.rows.map((row) => ({ name: row.name, source: `${row.source_schema}.${row.source_table}`, target: `${row.target_schema}.${row.target_table}`, definition: row.definition })),
    dependentViews: views.rows.map((row) => ({ schema: row.schema_name, name: row.object_name, kind: row.object_kind, sourceTable: row.source_table })),
    coverage: "database_catalog_only",
    sourceAuditPerformed: false,
    limitations: [
      "Covers declarative PostgreSQL foreign keys and view/materialized-view rewrite dependencies only.",
      "Does not inspect application source, dynamic SQL, triggers, functions, jobs or external consumers.",
    ],
  };
}

async function queueInventory(connection: Client, clientId: number | null) {
  const { rows: [presence] } = await connection.query<{ job: string | null; queue: string | null; version: string | null }>(
    "select to_regclass('pgboss.job')::text job, to_regclass('pgboss.queue')::text queue, to_regclass('pgboss.version')::text version",
  );
  const relationPresence = { job: Boolean(presence.job), queue: Boolean(presence.queue), version: Boolean(presence.version) };
  const relationCount = Object.values(relationPresence).filter(Boolean).length;
  const schemaState: "absent" | "partial" | "complete" = relationCount === 0 ? "absent" : relationCount === 3 ? "complete" : "partial";
  if (schemaState === "partial") {
    return {
      schemaState,
      relationPresence,
      schemaVersion: null,
      queuePresent: null,
      queueConfig: null,
      states: null,
      tenantStates: null,
      malformedClientScopeJobs: null,
      foreignClientJobs: null,
      pendingCount: null,
      oldestPendingAt: null,
    };
  }
  const versions = relationPresence.version
    ? await connection.query<{ version: number }>("select version from pgboss.version order by version desc limit 1")
    : { rows: [] as { version: number }[] };
  const queues = relationPresence.queue
    ? await connection.query<{ retry_limit: number; expire_seconds: number; partition: boolean }>("select retry_limit, expire_seconds, partition from pgboss.queue where name='research-run'")
    : { rows: [] as { retry_limit: number; expire_seconds: number; partition: boolean }[] };
  const jobs = !relationPresence.job ? { rows: [] as { state: string; row_count: string; tenant_count: string; malformed_count: string; foreign_count: string; oldest_pending_at: Date | null }[] }
    : clientId === null
      ? await connection.query<{ state: string; row_count: string; tenant_count: string; malformed_count: string; foreign_count: string; oldest_pending_at: Date | null }>(`
          select state::text, count(*)::text row_count, '0'::text tenant_count,
                 '0'::text malformed_count, '0'::text foreign_count,
                 min(created_on) filter (where state::text in ('created','retry','active')) oldest_pending_at
            from pgboss.job where name='research-run' group by state
        `)
      : await connection.query<{ state: string; row_count: string; tenant_count: string; malformed_count: string; foreign_count: string; oldest_pending_at: Date | null }>(`
          select state::text, count(*)::text row_count,
                 count(*) filter (where data->>'clientId'=$1::text)::text tenant_count,
                 count(*) filter (where data->>'clientId' is null or data->>'clientId' !~ '^[1-9][0-9]*$')::text malformed_count,
                 count(*) filter (where data->>'clientId' ~ '^[1-9][0-9]*$' and data->>'clientId'<>$1::text)::text foreign_count,
                 min(created_on) filter (where state::text in ('created','retry','active')) oldest_pending_at
            from pgboss.job where name='research-run' group by state
        `, [clientId]);
  const states = Object.fromEntries(JOB_STATES.map((state) => [state, 0])) as Record<string, number>;
  const tenantStates = clientId === null ? null : { ...states };
  let malformedClientScopeJobs = 0;
  let foreignClientJobs = 0;
  let oldestPendingAt: Date | null = null;
  for (const row of jobs.rows) {
    if (row.state in states) {
      states[row.state] = Number(row.row_count);
      if (tenantStates) tenantStates[row.state] = Number(row.tenant_count);
    }
    malformedClientScopeJobs += Number(row.malformed_count);
    foreignClientJobs += Number(row.foreign_count);
    if (row.oldest_pending_at && (!oldestPendingAt || row.oldest_pending_at < oldestPendingAt)) oldestPendingAt = row.oldest_pending_at;
  }
  const queue = queues.rows[0];
  return {
    schemaState,
    relationPresence,
    schemaVersion: versions.rows[0]?.version ?? null,
    queuePresent: Boolean(queue),
    queueConfig: queue ? { retryLimit: queue.retry_limit, expireSeconds: queue.expire_seconds, partition: queue.partition } : null,
    states,
    tenantStates,
    malformedClientScopeJobs: clientId === null ? null : malformedClientScopeJobs,
    foreignClientJobs: clientId === null ? null : foreignClientJobs,
    pendingCount: states.created + states.retry + states.active,
    oldestPendingAt: oldestPendingAt?.toISOString() ?? null,
  };
}

export async function collectInventory(connectionString: string, installationId: string) {
  const connection = new Client({ connectionString, application_name: "legacy-inventory" });
  await connection.connect();
  let transaction = false;
  try {
    await connection.query("begin isolation level repeatable read read only");
    transaction = true;
    await connection.query("set local statement_timeout='30s'");
    await connection.query("set local lock_timeout='1s'");
    await connection.query("set local idle_in_transaction_session_timeout='30s'");
    const readOnly = await connection.query<{ transaction_read_only: string }>("show transaction_read_only");
    if (readOnly.rows[0]?.transaction_read_only !== "on") throw new Error("legacy-inventory-read-only-transaction-required");
    const server = await connection.query<{ server_version_num: string }>("select current_setting('server_version_num') server_version_num");
    // node-postgres clients execute one query at a time. Keep this snapshot
    // explicitly sequential instead of relying on its deprecated query queue.
    const schemaPresence = await schemaPresenceInventory(connection);
    const migration = await migrationInventory(connection);
    const dependencies = await databaseDependencies(connection);
    const tenants = schemaPresence.clientRelationPresent
      ? await connection.query<{ id: number; slug: string }>("select id, slug from public.client order by id limit 2")
      : { rows: [] as { id: number; slug: string }[] };
    let clientScopeValidated = false;
    let tenant: { id: number; slug: string } | null = null;
    if (schemaPresence.clientRelationPresent) {
      tenant = resolveValidatedClientScope(process.env, tenants.rows);
      clientScopeValidated = tenant !== null;
    }
    const queue = await queueInventory(connection, tenant?.id ?? null);
    const canInspectLegacyRows = schemaPresence.discoveryState === "complete" && clientScopeValidated && tenant !== null;
    let tables = null;
    let fields = null;
    let anomalies = null;
    let statuses = null;
    let manifests: ReturnType<typeof projectAbilityManifest>[] | null = null;
    if (canInspectLegacyRows && tenant) {
      const baseCounts = await legacyCounts(connection, tenant.id);
      const manifestCounts = schemaPresence.optional.ability_manifest
        ? await abilityManifestCounts(connection, tenant.id)
        : { relationPresent: false, totalRows: null, tenantRows: null, globalRows: null, foreignRows: null };
      tables = { ...baseCounts, ability_manifest: manifestCounts };
      fields = await fieldPresence(connection, tenant.id);
      anomalies = await integrityAnomalies(connection, tenant.id);
      statuses = await statusCounts(connection, tenant.id);
      manifests = schemaPresence.optional.ability_manifest ? await abilityManifests(connection, tenant.id) : [];
    }
    const { discoveryState, discoveryFailures } = deriveDiscoveryResult({
      missingRequiredRelations: schemaPresence.missingRequired,
      clientRelationPresent: schemaPresence.clientRelationPresent,
      clientScopeValidated,
      queueSchemaState: queue.schemaState,
    });
    await connection.query("commit");
    transaction = false;
    return {
      schemaVersion: 1,
      kind: "legacy-inventory",
      toolVersion: 1,
      generatedAt: new Date().toISOString(),
      discoveryState,
      discoveryFailures,
      installation: { installationId, deploymentMode: "single-tenant", clientId: tenant?.id ?? null, clientScopeValidated, clientRowCount: tenants.rows.length },
      database: { serverVersionNum: server.rows[0].server_version_num, readOnlySnapshot: true, applicationRevision: process.env.APPLICATION_VERSION?.trim() || null, migration },
      legacy: { schemaPresence, tables, statusCounts: statuses, fieldPresence: fields, integrityAnomalies: anomalies, dependencies, abilityManifests: manifests },
      queue,
      limitations: [
        "Aggregate snapshot only; the checksum detects artifact modification but does not authenticate its origin or attest every source row.",
        "channel, market and audit_log are not provably tenant-attributable in the current schema.",
        "Queue state can change after this snapshot.",
        "Database dependency discovery covers foreign keys and views only; source code, dynamic SQL, triggers, functions, jobs and external consumers require a separate audit.",
        "This command does not perform a repository or external source-dependency audit.",
        "Complete installation discovery and approved storage remain external controls.",
      ],
    };
  } catch (error) {
    if (transaction) await connection.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export async function writeExclusive(path: string, contents: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    if (handle) await unlink(path).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function main() {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === "--") commandArguments.shift();
  const { values, positionals } = parseArgs({ args: commandArguments, allowPositionals: true, options: { "installation-id": { type: "string" }, output: { type: "string" } } });
  const installationId = values["installation-id"]?.trim();
  const output = values.output?.trim();
  if (positionals.length || !installationId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(installationId) || !output)
    throw new Error("Usage: pnpm legacy:inventory -- --installation-id OPAQUE_ID --output NEW_JSON_PATH");
  try { process.loadEnvFile(".env.local"); } catch { /* production injects configuration */ }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const artifact = checksummedArtifact(await collectInventory(process.env.DATABASE_URL, installationId));
  const outputPath = resolve(output);
  await writeExclusive(outputPath, `${canonicalJson(artifact)}\n`);
  console.log(JSON.stringify({ path: outputPath, digest: artifact.checksum.digest, discoveryState: artifact.discoveryState }));
  process.exitCode = inventoryExitCode(artifact.discoveryState);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  main().catch(() => {
    console.error("Legacy inventory failed. No database contents or connection details were printed; inspect configuration, permissions, migration state and the new output path.");
    process.exitCode = 1;
  });
}
