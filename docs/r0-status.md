# R0 scope-lock and baseline status

Updated: 2026-10-18
Blueprint: 2.1.0
Status: **R0A passed; R0B passed; R0 complete**

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
- The database migration head is `0019_r1a1b_bounded_retention`; Drizzle journal format `7` is not
  presented as the database version.
- Existing deterministic verification is green, including the empty-database migration and
  authenticated PostgreSQL integration suite. R1A1b's repository implementation passed GitHub
  Actions run `39109678811`, including migration, bounded continuation, concurrency, revocation/use
  races, fail-closed artifact reads, PgBoss lifecycle and authenticated HTTP coverage.
- No production source adapter, MCP implementation, host package, target ability or
  `decision-brief@2` implementation is claimed.
- The current broad abilities and product surfaces are explicitly unsupported/deferred even though
  code and tests exist.
- The old `last30days` path remains fail-closed and still ships in CI/Docker; the transitional worker
  still subscribes to its queue until R1A2, but it no longer owns the shared PgBoss lifecycle.

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
Read-only R1A1 discovery and the neutral worker-runtime extraction may now run to produce R0B
evidence. The repository now contains the neutral runtime, isolated canonical maintenance and the
read-only inventory command documented in [the R1A1 legacy inventory runbook](r1a1-legacy-inventory.md).
The repository portion of the separate dependency review is recorded in
[the R1A1 dependency audit](r1a1-dependency-audit.md); its live database,
queue/schedule, deployment, external-consumer, traffic and secret-inventory checks are not
applicable to the verified-zero current estate and must be repeated for the first installation.
Production-image removal proof is a separate R1A2 candidate/exit check, not a prerequisite to start
R1A2. These repository artifacts do not complete R1A1 for real installations. The
R1A1b bounded-maintenance contract is approved in [its decision record](r1a1b-bounded-maintenance-decision.md),
and its additive migration and repository-verifiable runtime exit gate are implemented and green in
CI run `39109678811`. The separate preservation/access, cleanup-objective and zero-estate index-
deployment decisions are accepted, so R1A2 implementation may begin. Destructive schema
work in R1B additionally requires the `legacy-data-disposition` decision and installation-specific
migration recovery controls. R3 separately requires the `primary-host` and
`oauth-reference-flow` decisions. A later R1B test must prove the new contraction migration from
`0019`.

The current repository-visible discovery is recorded in
[the R0B installation evidence record](r0b-installation-evidence.md). The assessed checkout had no
configured installation credentials or deployment manifest beyond the Dockerfile, and repository-
scoped GitHub queries returned no environments, deployments, variables, secrets or releases. The
project sponsor subsequently confirmed that no permanent installation, database, backup or
consumer exists, so the current estate is recorded as verified-zero. Martin has accepted all nine
temporary accountable roles; discovery of contrary estate evidence reopens the installation
inventory immediately.

The dependency audit found no canonical import of the detachable legacy runtime cluster. Before
R1A2, the handling of the persisted transitional-monitoring schedule must be owner-approved; the
actual unschedule/restart proof belongs to the R1A2 cutover. The current Docker standalone output
does not demonstrate a runnable worker entry point, and CI does not yet build and inspect the
production image; both are R1A2 candidate/exit work. The read-only inventory's foreign-key and view
catalog is intentionally not treated as complete dependency evidence.

## Safe R1 boundary already identified

`src/workers/pgBossRuntime.ts` now owns the shared PgBoss lifecycle. Canonical acquisition,
maintenance and synthesis compose through `src/workers/canonicalWorkers.ts`, independently of the
legacy run queue and transitional monitoring scheduler. R1A2 may remove `research-run`, the
transitional monitoring subscription and `last30days` code only after canonical
acquisition, synthesis, retention, session cleanup and graceful shutdown are proved on that runtime.

Legacy evidence and insights are not eligible for automatic promotion. Useful records must be
re-onboarded through canonical rights, methodology, minimization, applicability and review rules.
Historical migrations `0001`–`0019` remain immutable; schema cleanup uses a new forward migration
without `CASCADE`.
