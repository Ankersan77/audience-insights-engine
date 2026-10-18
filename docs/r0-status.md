# R0 scope-lock and baseline status

Updated: 2026-10-18
Blueprint: 2.1.0
Status: **R0 complete; R1A2 passed; R1B candidate verification pending**

R0 now has machine-readable product governance:

- `product-capabilities.json` records current and target capabilities, dependencies, versions,
  evidence, implementation surfaces and removal conditions;
- `compatibility-manifest.json` separates Blueprint, release, build, Core, database, contract,
  ability, MCP and host version axes;
- `product-decisions.json` records proposals, accountable roles, required gates and blockers;
- `r0-baseline.json` freezes routes, pages, queues, tables, providers, legacy closure and verification;
- `pnpm check:governance` rejects the encoded forms of drift, unknown references, cycles, forbidden
  active dependencies, edited migration history and unsupported production claims. Human review
  remains required for semantics and external evidence.

## What the baseline proves

- The current Blueprint, Roadmap, compatibility manifest and capability register agree on version
  2.1.0. The frozen pre-trim baseline/tag remains unchanged and does not claim to evidence R1A1b.
- The candidate database migration head is `0020_r1b_legacy_schema_cleanup`; Drizzle journal format
  `7` is not presented as the database version. R0 evidence remains anchored to its historical head.
- Existing deterministic verification is green, including the empty-database migration and
  authenticated PostgreSQL integration suite. R1A1b's repository implementation passed GitHub
  Actions run `39109678811`, including migration, bounded continuation, concurrency, revocation/use
  races, fail-closed artifact reads, PgBoss lifecycle and authenticated HTTP coverage.
- No production source adapter, MCP implementation, host package, target ability or
  `decision-brief@2` implementation is claimed.
- The current broad abilities and product surfaces are explicitly unsupported/deferred even though
  code and tests exist.
- The R0 baseline records the old ingestion path before removal; R1A2 removes its executable code
  and packaging while preserving the frozen baseline and historical schema for R1B.

## R0 closure

The installation, upgrade and recovery checks are now complete for the pre-deployment state:

1. the project sponsor declared a verified-zero estate: no permanent deployment, database, backup,
   data copy or external consumer exists;
2. the PostgreSQL 16 fixture in `integration/pre0018-upgrade.integration.ts` preserved
   representative legacy rows through the immutable history to `0019` in CI run `39109907282`;
3. PostgreSQL 16 native `pg_dump`/`pg_restore` preserved all 19 migrations and representative
   tenant/project/artifact data, and the current build completed an authenticated database-backed
   read in CI run `39114254560`.

Martin accepted all nine temporary pre-pilot accountable roles on 2026-10-18. The acceptance scope,
limitations and annual review point are recorded in `docs/r0b-owner-acceptance.json`. This closes
R0B and therefore R0. The primary host and OAuth reference flow are later R3 entry decisions and
were not decided by this acceptance.

R0A passed in remote CI run `39021713019`, including a fresh checkout of the annotated pre-trim tag.
Read-only R1A1 discovery and the neutral worker-runtime extraction produced the R0B evidence. The
historical inventory procedure is documented in
[the R1A1 legacy inventory runbook](r1a1-legacy-inventory.md), but the contracted release no longer
ships that pre-R1B command.
The repository portion of the separate dependency review is recorded in
[the R1A1 dependency audit](r1a1-dependency-audit.md); its live database,
queue/schedule, deployment, external-consumer, traffic and secret-inventory checks are not
applicable to the verified-zero current estate and must be repeated for the first installation.
Production-image removal proof is a separate R1A2 candidate/exit check, not a prerequisite to start
R1A2. These repository artifacts do not complete R1A1 for real installations. The
R1A1b bounded-maintenance contract is approved in [its decision record](r1a1b-bounded-maintenance-decision.md),
and its additive migration and repository-verifiable runtime exit gate are implemented and green in
CI run `39109678811`. The separate preservation/access, cleanup-objective and zero-estate index-
deployment decisions are accepted and R1A2 has passed. Martin approved the verified-zero
`legacy-data-disposition` in `docs/r1b-data-disposition.md`; R1B is implemented as candidate
migration `0020` and remains open until its immutable CI, recovery and forward-fix evidence passes.
R3 separately requires the `primary-host` and `oauth-reference-flow` decisions.

The current repository-visible discovery is recorded in
[the R0B installation evidence record](r0b-installation-evidence.md). The assessed checkout had no
configured installation credentials or deployment manifest beyond the Dockerfile, and repository-
scoped GitHub queries returned no environments, deployments, variables, secrets or releases. The
project sponsor subsequently confirmed that no permanent installation, database, backup or
consumer exists, so the current estate is recorded as verified-zero. Martin has accepted all nine
temporary accountable roles; discovery of contrary estate evidence reopens the installation
inventory immediately.

The dependency audit found no canonical import of the detachable legacy runtime cluster. R1A2
passed on candidate revision `5eadfa584ee4791286d4488a3fcf4810f3a65a86` in GitHub Actions run
`39126749699`, including immutable production-image inspection, idempotent retirement of the old
monitoring schedule, standalone canonical worker lifecycle, graceful drain and restart catch-up.
The read-only inventory's foreign-key and view catalog is intentionally not treated as complete
dependency evidence.

R1B has started under the explicit verified-zero `legacy-data-disposition`. Its candidate removes
only the 12 approved legacy tables and three enums in dependency order without `CASCADE`. It is not
passed until fresh/upgrade, fail-closed dependency, native restore/forward-again and canonical
regression evidence is green. Contrary estate discovery reopens installation-specific approval.

## Safe R1 boundary already identified

`src/workers/pgBossRuntime.ts` owns the PgBoss lifecycle. Canonical acquisition, maintenance and
synthesis compose through `src/workers/canonicalWorkers.ts`; the worker entry point registers only
those queues and retires the removed monitoring schedule before registration.

Legacy evidence and insights are not eligible for automatic promotion. Useful records must be
re-onboarded through canonical rights, methodology, minimization, applicability and review rules.
Historical migrations `0001`–`0019` remain immutable; schema cleanup uses a new forward migration
without `CASCADE`.
