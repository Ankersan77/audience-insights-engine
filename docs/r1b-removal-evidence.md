# R1B forward legacy schema cleanup evidence

Status: **candidate implemented; immutable CI evidence pending**

## Approved boundary

The data-owner decision is recorded in `docs/r1b-data-disposition.md`. The current estate is
verified-zero, so no installation records are exported, retained or tombstoned. Any discovered
installation, database, backup, export, consumer or queued legacy work invalidates this boundary and
reopens installation-specific preflight before deployment.

The recoverable pre-migration application/database boundary is annotated tag
`pre-r1b-v2.1.0`, pointing to green R1A2 revision
`85f52b0d21a13d9ad9dbc46283d53eefd47810e6`.

## Candidate assertions

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

## Required immutable evidence

The R1B candidate is not passed until GitHub Actions records the candidate revision, migration
history digest, fresh and upgrade results, dependency rollback assertions, native backup identifier,
SHA-256 and timing, forward-again result, canonical integration smoke and production build. This
section is completed only after that exact revision is green.
