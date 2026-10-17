# R0 scope-lock and baseline status

Updated: 2026-10-17  
Blueprint: 2.0.0  
Status: **R0A passed; R0B open**

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

- Blueprint and Roadmap agree on version 2.0.0.
- The database migration head is `0018_large_nick_fury`; Drizzle journal format `7` is not presented
  as the database version.
- Existing deterministic verification is green, including the empty-database migration and
  authenticated PostgreSQL integration suite in GitHub Actions run `39019288037`.
- No production source adapter, MCP implementation, host package, target ability or
  `decision-brief@2` implementation is claimed.
- The current broad abilities and product surfaces are explicitly unsupported/deferred even though
  code and tests exist.
- The old `last30days` path remains fail-closed but still ships in CI/Docker and still owns worker
  startup indirectly.

## Why R0 is still open

Repository tests cannot supply these missing facts:

1. the inventory of every deployed database and its legacy row/queue state;
2. an upgrade exercise from a representative pre-`0018` database with legacy rows through the
   existing immutable migrations to `0018`;
3. a timed restore from a PostgreSQL-native test backup;
4. acceptance of the accountable owner roles in `product-decisions.json`;
5. approval of the primary host and OAuth reference flow needed before R3.

R0A passed in remote CI run `39021713019`, including a fresh checkout of the annotated pre-trim tag.
Read-only R1A1 discovery and the neutral worker-runtime extraction may now run to produce R0B
evidence. R1A2 waits
for the complete installation inventory, recovery proof and owner acceptance. Destructive schema
work in R1B additionally requires the `legacy-data-disposition` decision and installation-specific
migration recovery controls. R3 additionally requires item 5. A later R1B test must separately prove
the new contraction migration from `0018`.

## Safe R1 boundary already identified

`src/workers/runQueue.ts` owns the only PgBoss lifecycle and passes that instance to canonical
workers. R1A1 must first extract a neutral PgBoss runtime and separate canonical maintenance from
parked monitoring. R1A2 may remove `research-run` and `last30days` code only after canonical
acquisition, synthesis, retention, session cleanup and graceful shutdown are proved on that runtime.

Legacy evidence and insights are not eligible for automatic promotion. Useful records must be
re-onboarded through canonical rights, methodology, minimization, applicability and review rules.
Historical migrations `0001`–`0018` remain immutable; schema cleanup uses a new forward migration
without `CASCADE`.
