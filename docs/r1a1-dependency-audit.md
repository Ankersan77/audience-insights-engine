# R1A1 dependency audit

Status: **repository review recorded; installation and external evidence open**

Reviewed: 2026-10-17

Applies before: R1A2 legacy code and packaging removal

This audit records the dependency evidence that cannot be inferred from the aggregate legacy
inventory alone. It separates facts visible in this repository from facts that must be collected
for every installation. It does **not** complete R0B or R1A1, approve a data disposition, authorize
R1A2, or authorize the destructive R1B schema migration.

## Scope and limitations

The repository review covers:

- static and dynamic imports into the legacy brand, instruction, run, evidence and insight path;
- raw or dynamically constructed SQL that names, or can reach, legacy relations;
- tracked PostgreSQL migrations and the current Drizzle snapshot;
- PgBoss producers, workers, queues and schedules declared in source;
- Docker, CI, Git-submodule and worker packaging;
- repository-documented operator procedures and possible external consumers.

It cannot prove the state of a deployed database, a PgBoss schema, an older deployed revision,
another infrastructure repository, a process manager, a secret store, traffic logs, BI/reporting
queries, copied scripts, backups or undocumented manual SQL. Repeat the repository review after any
material change and run the installation checks below against every entry in the authoritative
installation registry.

Do not copy function bodies, view definitions, job payloads, credentials, source rows or request
logs into this document. Store per-installation evidence on the approved encrypted, access-audited
location defined by `docs/r1a1-legacy-inventory.md`.

## Repository evidence matrix

| Area | Evidence | Repository conclusion | Closure required before R1A2 |
| --- | --- | --- | --- |
| Legacy import graph | `src/workers/index.ts` imports `runQueue`; `src/workers/runQueue.ts` is the only runtime bridge to `runLast30Days`, `draftInsights`, legacy run/evidence queries and the legacy SLO. `app/api/runs/trigger/route.ts` is its only repository queue producer. `src/workers/canonicalWorkers.ts` imports none of those modules. | The runtime path is detachable as one cluster. | Remove the complete cluster in one reviewable release and rerun the canonical worker lifecycle proof. |
| Legacy web/query surface | `app/brands`, `app/runs`, `app/insights`, their six API routes, and the five legacy query modules are mutually contained. The run trigger is fail-closed, but brand/instruction writes, insight review and run cancellation remain reachable by direct URL. | No canonical runtime import needs these query modules, but the surface is not inert. | Confirm consumers and traffic, establish a write quiesce, remove every route/page, and prove the routes return 404. |
| Shared modules | `src/lib/audit.ts` contains both legacy `recordAudit` and canonical `recordGovernanceAudit`. `src/lib/metrics.ts` contains shared `logEvent` plus legacy run-SLO code. `src/db/schema.ts` contains both legacy and canonical schema. | Whole-file deletion would regress canonical behavior or prematurely change schema. | Remove only legacy exports/imports in R1A2; retain the Drizzle legacy definitions unchanged until R1B. |
| Dynamic SQL | `scripts/legacy-inventory.ts` deliberately reads all legacy relations. `scripts/bootstrap-client-owned.ts` dynamically inspects every public table without naming a legacy table. `integration/legacy-inventory-cases.ts` and `integration/pre0018-upgrade.integration.ts` are test-only legacy SQL. | No hidden production dynamic-SQL consumer was found in the repository. | Keep inventory/upgrade evidence until R1B. Recheck application source after the R1A2 edit. |
| Database objects | `drizzle/meta/0018_snapshot.json` declares no application views or policies. Migrations `0001`-`0018` create no application trigger, function, procedure, view or materialized view. Declarative foreign keys are already captured by the inventory artifact. | Tracked schema history contains no hidden procedural dependency. | Run the catalog checks below on every installation because out-of-band objects are not represented here. |
| Legacy queue | `research-run` is event-driven, not scheduled. `src/workers/index.ts` still registers its worker. | Removing the subscriber is code-safe only after pending work is resolved. | Require zero `created`, `retry` and `active` jobs and confirm there is no external producer or older web deployment. Do not delete PgBoss rows ad hoc. |
| Standalone legacy purge | `src/workers/purgeEvidence.ts` is separately executable, reads `EVIDENCE_RETENTION_DAYS` and can delete every matching legacy evidence row in one unbounded statement. It is not currently imported or scheduled by repository runtime code. | Absence from the worker composition does not make the operator entry point or deployment configuration inert. | Inventory operator use and deployment configuration, keep it disabled during R1A1, and remove or redirect it to the bounded canonical retention path in R1A2. |
| Persisted schedules | Canonical maintenance and synthesis schedules are declared in `src/workers/canonicalMaintenance.ts` and `src/workers/synthesisMaintenance.ts`. `src/workers/canonicalQueue.ts` also persists the deferred monitoring schedule. | Removing a registration call does not delete an existing PgBoss schedule. | Explicitly unschedule `market-research-monitoring-scheduler`, handle its pending jobs and prove the schedule is absent after restart. Preserve canonical schedules. |
| Docker and Git | `Dockerfile` installs Python and copies `vendor/last30days`; `.gitmodules` owns the gitlink; `.github/workflows/ci.yml` fetches submodules. | All are direct legacy packaging dependencies. | Remove them together and inspect the built image for absence of Python and the vendored engine. |
| Worker artifact | The current `.next/standalone` output contains neither `src/workers/index.ts` nor `tsx`; the Docker runtime copies only the standalone web output, static/public assets and the vendor directory. | The repository does not currently prove that `pnpm worker` is runnable in the production image. | Define and test the actual canonical worker artifact/entry point before claiming that the final image starts only canonical queues. |
| CI image proof | CI runs `pnpm build`, not `docker build`, image inspection or an SBOM assertion. | The R1A2 production-image exit gate is not implemented. | Build and inspect the production image in CI; record immutable image evidence. |
| Documented consumers | `docs/runbook.md` documents legacy research-run mutation; `docs/dsr-procedure.md` reads/deletes legacy evidence; the inventory command remains an intentional reader. | Known operator consumers exist even after UI removal. | Retire the run mutation procedure. Keep controlled inventory and DSR access until the R1B disposition/destruction gate closes. |
| Governance guard | `scripts/validate-product-governance.mjs` checks only a subset of legacy paths when `legacyLast30days` becomes `removed`. | A partial trim could pass governance. | Reject leftover legacy routes, worker registration, Python/vendor packaging, submodule checkout, query modules, parser, feature flag and direct Anthropic path. |

The defensive rejection of identity-bearing keys such as `author_handle` in
`src/evidence/policy.ts` is a canonical security control, not a legacy dependency. Preserve it.
Historical migrations, the frozen R0 baseline/tag and superseded ADRs also remain as historical
evidence; they must not recreate an active runtime or packaging dependency.

## Required per-installation read-only checks

Use the same SELECT-only role, tenant pinning, encrypted evidence storage, expiry and access audit as
the legacy inventory. First run that inventory and require a complete PgBoss schema before querying
`pgboss.*`. Execute the following in a `REPEATABLE READ READ ONLY` transaction with bounded statement
and lock timeouts. The queries return metadata and aggregate counts, not job payloads or legacy rows.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
```

### Triggers attached to legacy relations

```sql
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       md5(pg_get_triggerdef(t.oid, true)) AS definition_fingerprint
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND c.relname = ANY (ARRAY[
    'ability_manifest','audit_log','market','brand','brand_market',
    'research_instruction','channel','insight_route','research_run',
    'evidence','insight','insight_evidence'
  ])
ORDER BY 1,2,3;
```

Every returned row is a blocker until an owner securely reviews its full definition and records a
retain/remove plan. The fingerprint supports comparison only; it is not authenticity proof.

### Functions or procedures containing legacy relation names

```sql
SELECT n.nspname AS schema_name,
       p.proname AS routine_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       md5(pg_get_functiondef(p.oid)) AS definition_fingerprint
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f','p')
  AND n.nspname NOT IN ('pg_catalog','information_schema','pgboss')
  AND pg_get_functiondef(p.oid) ~*
      '\m(ability_manifest|audit_log|brand_market|research_instruction|insight_route|research_run|insight_evidence|channel|evidence|insight|brand|market)\M'
ORDER BY 1,2,3;
```

This intentionally broad text check can produce false positives, but it also catches dynamic SQL
that does not create a dependable `pg_depend` edge. Every result requires secure review; an empty
result must be retained as evidence and is not a substitute for checking external code.

### Views and materialized views

```sql
SELECT DISTINCT vns.nspname AS schema_name,
       view_object.relname AS object_name,
       CASE view_object.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END AS object_kind,
       sns.nspname AS source_schema,
       source.relname AS source_table
FROM pg_depend dependency
JOIN pg_rewrite rewrite ON rewrite.oid = dependency.objid
JOIN pg_class view_object ON view_object.oid = rewrite.ev_class
JOIN pg_namespace vns ON vns.oid = view_object.relnamespace
JOIN pg_class source ON source.oid = dependency.refobjid
JOIN pg_namespace sns ON sns.oid = source.relnamespace
WHERE sns.nspname = 'public'
  AND source.relname = ANY (ARRAY[
    'ability_manifest','audit_log','market','brand','brand_market',
    'research_instruction','channel','insight_route','research_run',
    'evidence','insight','insight_evidence'
  ])
  AND view_object.relkind IN ('v','m')
ORDER BY 1,2,4,5;
```

Reconcile this result with the inventory artifact. Any additional or changed dependency blocks
progress until its owner and disposition are recorded.

### PgBoss queues, schedules and aggregate job states

```sql
SELECT name, retry_limit, expire_seconds, partition
FROM pgboss.queue
ORDER BY name;

SELECT name, key, kind, cron, timezone, options, created_on, updated_on, last_job_id
FROM pgboss.schedule
ORDER BY name, key;

SELECT name,
       state::text AS state,
       count(*) AS job_count,
       min(created_on) AS oldest_created_on,
       max(created_on) AS newest_created_on
FROM pgboss.job
GROUP BY name, state
ORDER BY name, state;
```

The complete result must match the reviewed source inventory. `research-run` requires zero
`created`, `retry` and `active` jobs before its subscriber is removed. The monitoring schedule must
be absent after the approved unschedule/restart operation. Do not copy `pgboss.job.data` into audit
evidence and do not manipulate PgBoss relations directly.

```sql
ROLLBACK;
```

## External and deployment evidence

For every installation, the migration owner and deployment owner must jointly record:

- deployed web and worker revision/image digest, process commands and replica count;
- all deployment/IaC repositories, process-manager definitions, scheduled tasks and webhook jobs;
- traffic-log evidence for `/brands`, `/runs`, `/insights` and their API routes over the approved
  observation window, with request bodies, cookies and identities excluded;
- every API client, BI/reporting query, copied script or manual operating procedure that reads or
  writes the legacy tables or sends `research-run` jobs;
- the complete queue/schedule output above and the operator-approved handling of pending work;
- secret-store references for `ENABLE_LEGACY_LAST30DAYS`, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_INSIGHT_MODEL`, `X_BEARER_TOKEN`, `XAI_API_KEY` and
  `SCRAPECREATORS_API_KEY`, plus any `EVIDENCE_RETENTION_DAYS` configuration or manual invocation
  of the standalone legacy purge, including revocation/removal timing and rollback implications;
- an immutable production-image inspection or SBOM proving no Python executable/package and no
  `/app/vendor/last30days`, plus a successful canonical worker startup/drain from that artifact;
- owner, timestamp, durable evidence reference and remediation ticket for every exception.

Repository silence is not evidence that an external consumer, older deployment or secret does not
exist. An unknown installation, consumer or process is a failing state.

## Closure checklist

- [x] Repository import graph, dynamic SQL, tracked schema, queue declarations and packaging were
      reviewed and recorded in this document.
- [ ] The document is rechecked against the immutable R1A2 candidate revision and accepted by the
      migration owner and deployment owner.
- [ ] Every authoritative installation has a complete, checksum-verified legacy inventory.
- [ ] Trigger, function/procedure, view/materialized-view and PgBoss queries above are recorded for
      every installation; all returned dependencies have an approved disposition.
- [ ] `research-run` has zero `created`, `retry` and `active` jobs and no external or old-revision
      producer can enqueue new work.
- [ ] The deferred monitoring schedule is explicitly removed and produces no further jobs.
- [ ] Route/API traffic, external consumers, deployment/process definitions and secret-store
      references are inventoried with no unknown owner, including any operator use or configuration
      of the standalone legacy purge.
- [ ] The R1A2 candidate production image starts the canonical worker, excludes Python and the
      vendored engine, and has immutable inspection or SBOM evidence from CI.
- [ ] Governance rejects every active legacy code, route, queue-registration and packaging path
      while preserving shared canonical audit, telemetry and identity-field defenses.
- [ ] R0B recovery, owner acceptance and data-disposition gates are independently complete.

## R1A2 gate conclusion

**Blocked.** The repository review identifies a bounded removal cluster and no canonical import of
that cluster, but per-installation catalogs, queue/schedule state, deployment packaging, external
consumer/traffic evidence, secret retirement, image proof, R0B recovery and accountable acceptance
remain open. This document may support those decisions; it is not approval to start R1A2.
Roadmap R1A1b must also pass independently before R1A2 may start.
