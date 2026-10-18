# R1B forward legacy schema cleanup evidence

Status: **passed**

## Approved boundary

The data-owner decision is recorded in `docs/r1b-data-disposition.md`. The current estate is
verified-zero, so no installation records are exported, retained or tombstoned. Any discovered
installation, database, backup, export, consumer or queued legacy work invalidates this boundary and
reopens installation-specific preflight before deployment.

The recoverable pre-migration application/database boundary is annotated tag
`pre-r1b-v2.1.0`, pointing to green R1A2 revision
`85f52b0d21a13d9ad9dbc46283d53eefd47810e6`.

## Verified assertions

- migration `0020_r1b_legacy_schema_cleanup` appends to immutable migrations `0001`–`0019`;
- exactly 12 approved legacy tables and three legacy enum types are dropped explicitly in dependency
  order, without `CASCADE` or `IF EXISTS`;
- unknown foreign-key and enum dependencies fail the complete migration transaction and leave the
  `0019` state intact;
- fresh installation and representative `0019` upgrade end with no approved legacy relation, enum
  or `author_handle` column;
- shared account rows and canonical source, evidence, context, artifact, Market Twin, review and
  governance behavior remain intact;
- legacy `audit_log` data is not copied into `governance_audit`;
- the pre-R1B inventory command and SQL-only DSR procedure are retired from the active release;
- a PostgreSQL 16 native backup at `0019` is checksum-verified after isolated restore, then the
  restored copy migrates forward to `0020` and completes an authenticated canonical read;
- there is no down migration. Recovery uses the tagged pre-R1B artifact with its restored `0019`
  database, or a separately reviewed append-only forward fix.

## Immutable evidence

Candidate revision `a6366b4f0ec39a481718c22e80b0ecebf0c394f3` passed GitHub Actions run
[`39130855147`](https://github.com/man-D4wn/Market-research/actions/runs/39130855147) on
2026-10-18. The run passed governance, lint, type-check, 272 unit tests, production build,
PostgreSQL integration, fresh install, representative `0019` upgrade, both dependency rollback
cases, canonical regression, native backup/restore/forward-again, authenticated release read and
production web/worker image inspection.

The immutable artifact
`r1b-migration-evidence-a6366b4f0ec39a481718c22e80b0ecebf0c394f3` has GitHub artifact ID
`12138251293` and archive digest
`sha256:d6d483468e3a17e5b94528f03b7123a013924b8b13837db7380c7dedb6f812c4`.
Its PostgreSQL 16 recovery report records:

- backup ID `synthetic:market_research_backup_source_24612c75d004_test:2026-10-18T13:18:33.033Z`;
- backup SHA-256 `sha256:a8f1b9f11457aa7e8deea9001bc0b0a2187984631afabe4ef1ee165bbeb82144`
  over 171,150 bytes;
- 539 ms backup, 864 ms restore command, 1,668 ms synthetic recovery and 81 ms forward migration;
- 19 migrations before R1B and 20 afterward, ending at
  `0020_r1b_legacy_schema_cleanup` with immutable-history digest
  `sha256:704ff7f4fa527575111b9f8635e5964efd6963c832c2316cf39861fbf11ff602`;
- matching restored canonical record counts, all 12 approved relations and three enum types
  contracted, successful forward migration, and successful authenticated canonical read.

The timings are synthetic CI fixture measurements, not production recovery objectives. The artifact
expires on 2027-01-16 under GitHub retention; this checked-in record, migration history, candidate
revision and pre-R1B recovery tag remain durable repository evidence.
