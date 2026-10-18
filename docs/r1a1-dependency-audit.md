# R1A1 dependency audit

> Historical R1A1/R1A2 evidence. The R1B forward migration subsequently removed the approved
> legacy schema; current R1B evidence is recorded in `docs/r1b-removal-evidence.md`.

Status: **R1A2 passed with immutable CI exit evidence**

Reviewed: 2026-10-18

Applies to: the prerequisites for starting R1A2 and the separate R1A2 candidate/exit review

This audit records the dependency evidence that cannot be inferred from the aggregate legacy
inventory alone. It separates facts visible in this repository from facts that must be collected
for every installation. It does **not** complete R0B or R1A1, approve the R1A2 preservation/access
disposition, approve the final destructive R1B disposition, authorize R1A2, or authorize the
destructive R1B schema migration. The prerequisite evidence in this document must close before
R1A2 begins. Checks that can only be performed on the changed R1A2 candidate are explicitly
separated and are R1A2 exit evidence, not prerequisites to start it.

The repository evidence matrix below is the pre-removal snapshot used to define the cut. Current
candidate evidence is recorded in `docs/r1a2-removal-evidence.md`; the snapshot is retained so the
review remains reproducible rather than silently rewritten as if the dependencies never existed.

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

| Area | Evidence | Repository conclusion | Required timing |
| --- | --- | --- | --- |
| Legacy import graph | `src/workers/index.ts` imports `runQueue`; `src/workers/runQueue.ts` is the only runtime bridge to `runLast30Days`, `draftInsights`, legacy run/evidence queries and the legacy SLO. `app/api/runs/trigger/route.ts` is its only repository queue producer. `src/workers/canonicalWorkers.ts` imports none of those modules. | The runtime path is detachable as one cluster. | **R1A2 exit:** remove the complete cluster in one reviewable release and rerun the canonical worker lifecycle proof. |
| Legacy web/query surface | `app/brands`, `app/runs`, `app/insights`, their six API routes, and the five legacy query modules are mutually contained. The run trigger is fail-closed, but brand/instruction writes, insight review and run cancellation remain reachable by direct URL. | No canonical runtime import needs these query modules, but the surface is not inert. | **Before R1A2:** confirm consumers and traffic and approve the cutover/write-quiesce plan. **R1A2 exit:** remove every route/page and prove the routes return 404. |
| Shared modules | `src/lib/audit.ts` contains both legacy `recordAudit` and canonical `recordGovernanceAudit`. `src/lib/metrics.ts` contains shared `logEvent` plus legacy run-SLO code. `src/db/schema.ts` contains both legacy and canonical schema. | Whole-file deletion would regress canonical behavior or prematurely change schema. | **R1A2 implementation:** remove only legacy exports/imports; retain the Drizzle legacy definitions unchanged until R1B. |
| Dynamic SQL | `scripts/legacy-inventory.ts` deliberately reads all legacy relations. `scripts/bootstrap-client-owned.ts` dynamically inspects every public table without naming a legacy table. `integration/legacy-inventory-cases.ts` and `integration/pre0018-upgrade.integration.ts` are test-only legacy SQL. | No hidden production dynamic-SQL consumer was found in the repository. | **Before R1A2:** preserve inventory/upgrade evidence. **R1A2 exit:** recheck application source. Keep controlled inventory evidence until R1B. |
| Database objects | `drizzle/meta/0019_snapshot.json` declares no application views or policies. Migrations `0001`-`0019` create no application trigger, function, procedure, view or materialized view. Declarative foreign keys are already captured by the inventory artifact. | Tracked schema history contains no hidden procedural dependency. | **Before R1A2:** run the catalog checks below on every installation because out-of-band objects are not represented here. |
| Legacy queue | `research-run` is event-driven, not scheduled. `src/workers/index.ts` still registers its worker. | Removing the subscriber is code-safe only after pending work is resolved. | **Before R1A2:** require zero `created`, `retry` and `active` jobs and confirm there is no external producer or older web deployment. Do not delete PgBoss rows ad hoc. **R1A2 exit:** prove the subscriber is absent. |
| Standalone legacy purge | `src/workers/purgeEvidence.ts` is separately executable, reads `EVIDENCE_RETENTION_DAYS` and can delete every matching legacy evidence row in one unbounded statement. It is not currently imported or scheduled by repository runtime code. | Absence from the worker composition does not make the operator entry point or deployment configuration inert. | **Before R1A2:** inventory operator use and deployment configuration and keep it disabled. **R1A2 exit:** remove it or redirect exclusively to bounded canonical retention. |
| Persisted schedules | Canonical maintenance and synthesis schedules are declared in `src/workers/canonicalMaintenance.ts` and `src/workers/synthesisMaintenance.ts`. `src/workers/canonicalQueue.ts` also persists the deferred monitoring schedule. | Removing a registration call does not delete an existing PgBoss schedule. | **Before R1A2:** approve handling of the deferred monitoring schedule and its pending jobs. **R1A2 cutover/exit:** explicitly unschedule `market-research-monitoring-scheduler`, prove it remains absent after restart and preserve canonical schedules. |
| Docker and Git | `Dockerfile` installs Python and copies `vendor/last30days`; `.gitmodules` owns the gitlink; `.github/workflows/ci.yml` fetches submodules. | All are direct legacy packaging dependencies. | **R1A2 exit:** remove them together and inspect the built image for absence of Python and the vendored engine. |
| Worker artifact | The current `.next/standalone` output contains neither `src/workers/index.ts` nor `tsx`; the Docker runtime copies only the standalone web output, static/public assets and the vendor directory. | The repository does not currently prove that `pnpm worker` is runnable in the production image. | **R1A2 exit:** define and test the canonical worker artifact/entry point before claiming that the final image starts only canonical queues. |
| CI image proof | CI runs `pnpm build`, not `docker build`, image inspection or an SBOM assertion. | The R1A2 production-image exit gate is not implemented. | **R1A2 exit:** build and inspect the production image in CI; record immutable image evidence. |
| Documented consumers | `docs/runbook.md` documents legacy research-run mutation; `docs/dsr-procedure.md` reads/deletes legacy evidence; the inventory command remains an intentional reader. | Known operator consumers exist even after UI removal. | **Before R1A2:** inventory their owners and use. **R1A2 exit:** retire the run mutation procedure. Keep controlled inventory and DSR access until the R1B disposition/destruction gate closes. |
| Governance guard | `scripts/validate-product-governance.mjs` checks only a subset of legacy paths when `legacyLast30days` becomes `removed`. | A partial trim could pass governance. | **R1A2 exit:** reject leftover legacy routes, worker registration, Python/vendor packaging, submodule checkout, query modules, parser, feature flag and direct Anthropic path. |

The defensive rejection of identity-bearing keys such as `author_handle` in
`src/evidence/policy.ts` is a canonical security control, not a legacy dependency. Preserve it.
Historical migrations, the frozen R0 baseline/tag and superseded ADRs also remain as historical
evidence; they must not recreate an active runtime or packaging dependency.

## Verified-zero installation route

An authoritative registry may contain zero deployed installations. That is not the same as an
unknown inventory and must not be inferred from repository silence. For a project that has never
been deployed, the project sponsor may declare the complete current
estate verified-zero with timestamp, scope and durable evidence; repository-visible systems are
checked where they exist. Formal operations/data role acceptance remains the separate R0B owner
gate. Do not invent an installation ID or run the inventory command without a database merely to
create an empty artifact.

A verified-zero attestation closes only the per-installation inventory, catalog, queue, deployment,
traffic, consumer and secret checks that have no target installation. It does not waive accountable
owner acceptance, the representative pre-`0018` upgrade through the current
`0019_r1a1b_bounded_retention` head, the timed PostgreSQL-native restore exercise, the cleanup
service objective or the policy for index builds on a future installation. The current verified-zero
attestation is recorded in `docs/r0b-installation-evidence.md` and automatically reopens if contrary
estate evidence is discovered.

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
`created`, `retry` and `active` jobs before its subscriber is removed. Before R1A2, record the
monitoring schedule and approve handling of it and any pending jobs; the R1A2 cutover/exit evidence
must prove that the approved unschedule/restart operation leaves it absent. Do not copy
`pgboss.job.data` into audit evidence and do not manipulate PgBoss relations directly.

```sql
ROLLBACK;
```

## External and deployment evidence required before R1A2

For every installation, the **data owner acting as migration owner** and the **operations owner
acting as deployment owner** must jointly record:

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
- owner, timestamp, durable evidence reference and remediation ticket for every exception.

Repository silence is not evidence that an external consumer, older deployment or secret does not
exist. An unknown installation, consumer or process is a failing state.

## Prerequisites-to-start checklist

- [x] Repository import graph, dynamic SQL, tracked schema, queue declarations and packaging were
      reviewed and recorded in this document.
- [x] The authoritative installation registry is accepted as complete by the data owner and
      operations owner, with neither unknown nor `not supplied` entries. If it contains zero
      installations, the verified-zero route above is fully evidenced and accepted.
- [x] No registered installation exists, so no per-installation checksum inventory is applicable.
- [x] No installation exists on which catalog or PgBoss queries can apply; they become mandatory if
      any database is discovered.
- [x] No installed `research-run` queue or producer exists in the verified-zero estate.
- [x] Handling of the deferred monitoring schedule and any pending jobs is approved for the R1A2
      cutover without changing canonical schedules.
- [x] No route traffic, external consumer, deployment/process definition, installation secret or
      standalone purge invocation exists; discovery of one reopens the gate.
- [x] The zero-estate preservation/access decision is accepted in
      `docs/r1a2-entry-decisions.md`; it authorizes no schema/data destruction.
- [x] The representative pre-`0018` upgrade with legacy rows passes through the current
      `0019_r1a1b_bounded_retention` head and is owner-accepted.
- [x] R0B recovery and accountable owner acceptance are independently complete, including the
      timed PostgreSQL-native restore.
- [x] The separate R1A2 cleanup-objective and index-deployment decisions are accepted for the
      verified-zero estate and reopen before the first installation.

## R1A2 candidate and exit evidence

These checks require the changed R1A2 candidate and do not block the start of R1A2 after the
prerequisite checklist above passes:

- [x] This audit is rechecked against the immutable R1A2 candidate revision and accepted by the data
      owner acting as migration owner and the operations owner acting as deployment owner.
- [x] Every legacy route/page, queue subscriber, legacy purge path and packaging dependency listed
      above is removed or redirected exactly as the Roadmap requires; legacy routes return 404.
- [x] The deferred monitoring schedule is explicitly removed, produces no further jobs and remains
      absent after restart, while canonical schedules remain present.
- [x] The candidate production image starts and drains the canonical worker, starts only approved
      canonical queues, excludes Python and `/app/vendor/last30days`, and has immutable CI image or
      SBOM evidence.
- [x] The governance check rejects every active legacy code, route, queue-registration and
      packaging path while preserving shared canonical audit, telemetry and identity-field defenses.
- [x] Canonical lifecycle, build and all non-destructive integration verification remain green, and
      legacy database state remains unchanged and operator-readable pending R1B.

## R1A2 gate conclusion

**Passed.** The repository review identifies a bounded removal cluster and no canonical import of
that cluster. The estate is verified-zero, R0B and R1A1b pass, and the preservation/access, cleanup
objective, index-deployment and empty-fleet cutover decisions are accepted. Candidate revision
`5eadfa584ee4791286d4488a3fcf4810f3a65a86` passed the removal guard, production-image inspection
and post-change lifecycle proof in GitHub Actions run `39126749699`. Detailed immutable identifiers
and assertions are recorded in `docs/r1a2-removal-evidence.md`.
