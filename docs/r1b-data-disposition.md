# R1B verified-zero legacy data disposition

Status: **accepted for the current verified-zero estate**

Accepted by: Martin, acting as temporary `data-owner` (migration owner) and `operations-owner`

Accepted at: 2026-10-18T13:00:39Z

Applies before: R1B

## Estate boundary

The current project has no permanent deployment, database, backup, export, retained data copy,
external consumer or queued legacy work. This decision therefore covers the repository baseline and
synthetic verification estate only. Discovery of any contrary estate evidence stops R1B deployment
and requires installation-specific inventory, preservation, recovery and owner go/no-go evidence.

## Approved disposition

- Export: none. There are no installation records to export.
- Retention: none. No legacy row is promoted or copied into canonical evidence, Market Twin or
  governance storage.
- Tombstones: none. No installation subject, legal hold or retained record requires a tombstone.
- Deletion: remove the obsolete legacy schema through one forward-only migration after the
  repository recovery exercise passes.

The approved tables are `market`, `brand`, `brand_market`, `research_instruction`, `channel`,
`insight_route`, `research_run`, `evidence`, `insight`, `insight_evidence`, `audit_log` and
`ability_manifest`. The approved enum types are `channel_type`, `research_run_status` and
`insight_delivery_status`. Their indexes, sequences, constraints and foreign keys are removed only
as consequences of dropping these exact tables or types.

Canonical, account, company-context, solution-profile, source, acquisition, evidence, Market Twin,
artifact, campaign, monitoring, quality and `governance_audit` storage is explicitly outside this
disposition.

## Migration and recovery controls

- Migrations `0001`–`0019` remain byte-for-byte unchanged. R1B appends a new migration.
- Every table and type is dropped explicitly without `CASCADE`, in dependency order. An unknown
  dependency must fail closed.
- Fresh installation and representative pre-`0018` upgrade tests must end at the new migration head
  with no approved legacy relation or identity-bearing legacy field remaining.
- A synthetic PostgreSQL-native backup is taken at the `0019` boundary, restored into an isolated
  database, verified with representative legacy rows, and then migrated forward again. Timing and
  immutable CI evidence are recorded before R1B is closed.
- Old code is compatible only with the pre-R1B database. There is no production down-migration.
  Recovery uses the installation-specific restore/PITR plan or a reviewed forward fix.
- The verified R1A2 revision remains the recoverable pre-schema-cleanup application artifact.

## Go/no-go

Martin approves the repository R1B migration candidate under the boundaries above. This is not a
production migration authorization for a later-discovered installation. Such an installation must
reopen this decision and satisfy the Roadmap's backup checksum, RPO/RTO, write-quiesce or WAL/PITR,
queue, dependency and explicit owner go/no-go controls before migration.

## Non-approval

This record does not activate a source, ability, host integration, monitoring feature or production
service claim. It does not authorize changes to canonical/deferred product data or historical
migrations.
