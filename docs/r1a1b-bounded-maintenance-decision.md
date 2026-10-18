# R1A1b bounded-maintenance decision

## Decision record

| Field | Value |
|---|---|
| Status | Approved architecture and delivery contract |
| Approved | 2026-10-18 |
| Approval source | Direct user authorization in the task that requested the Blueprint/Roadmap work |
| Required before | R1A1b implementation |
| Review by | 2027-10-18, or earlier if the contract, data model or installation profile changes materially |

The approval authorizes an isolated additive R1A1b before R1A2. It does not assign or accept any
named governance-owner role, close R0B, approve a production deployment or authorize legacy code or
data removal.

## Approved boundaries

| Boundary | Approved maximum or rule |
|---|---:|
| Maintenance handler wall budget | 240 seconds |
| SQL statement timeout | 10 seconds |
| SQL lock timeout | 1 second |
| Session rows per run | 500 |
| Newly discovered evidence work rows per run | 100 |
| Retention work chunks per run | 20 |
| Lightweight dependant rows per chunk | 100 |
| Artifact rows per chunk | 10 |
| Collections per run | 250 |
| Intelligence records per run | 250 |
| Stale acquisitions per run | 100 |
| Acquisition dispatch attempts per run | 100 |
| Serialized artifact JSON | 256 KiB (262,144 UTF-8 bytes) |
| Evidence references per artifact | 100 |

Source revocation is approved as an O(1) control-plane write followed by bounded durable cleanup. New
dispatch, evidence use and result persistence fail closed immediately. The response reports
`cleanupPending` and does not imply that synchronous affected-row counts are complete.

Fail-closed artifact projection is mandatory for every web and MCP artifact DTO while cleanup is
pending. Read-time protection and persistent cleanup are both required.

## Deliberately still open

- the maximum acceptable cleanup backlog age/service objective;
- the index-build method and maintenance window for each installation;
- the inventory and disposition of every installation;
- timed PostgreSQL-native restore evidence;
- named owner-role acceptance and durable acceptance evidence; and
- every other R0B, R1A2, R1B and production-support gate.

Implementation evidence—not this decision record—must prove the limits, concurrency behavior,
tenant isolation, revocation races, projection behavior, PgBoss lifecycle and rollback controls.
