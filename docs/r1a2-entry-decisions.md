# R1A2 verified-zero entry decisions

Status: **accepted for the current verified-zero estate**

Accepted by: Martin, acting as temporary `data-owner` and `operations-owner`

Accepted at: 2026-10-18T11:05:39Z

Applies before: R1A2

This decision record applies only because the current project has no deployment, persistent
database, backup, retained installation data, external consumer, queued legacy work or persisted
schedule. Discovery of any contrary evidence immediately reopens every decision below and blocks
R1A2 until installation-specific evidence exists.

## Legacy records after application-code removal

Decision: `legacy-code-removal-data-access` is **not applicable to the current empty fleet**.

- R1A2 removes application/runtime access paths only. It does not delete or rewrite legacy schema
  or rows.
- No installation records exist that require an export, operator SQL access or preservation plan.
- The legacy schema and representative synthetic rows remain available in migrations/tests until
  the separate R1B disposition decision.
- If an installation or retained data copy is discovered, R1A2 stops and a checksum-bearing,
  owner-approved preservation/access record becomes mandatory.

## Canonical cleanup objective

Decision: `canonical-cleanup-slo` is **not applicable to the current empty fleet**.

- No production backlog exists and no production cadence, maximum backlog age or incident response
  can be honestly measured.
- R1A2 relies only on the already accepted bounded-maintenance safety contract and its deterministic
  PostgreSQL tests; this is not a production service-level claim.
- Before the first installation, the operations owner must set a measured cleanup cadence, maximum
  backlog age, alert threshold and escalation path. Material volume changes reopen that decision.

## Migration 0019 index deployment

Decision: `r1a1b-index-deployment` is **not applicable to the current empty fleet**.

- No installed database requires an index-build maintenance window.
- Fresh databases apply the immutable migration history, including `0019`, before accepting work.
- Any future import, restored database or discovered installation requires size measurement and an
  owner-approved maintenance method. A concurrent index rollout requires a separately reviewed
  forward migration; historical migration `0019` is never edited.

## R1A2 cutover plan for an empty fleet

- There is no live legacy producer, `research-run` backlog, deferred monitoring schedule, route
  traffic, secret-store reference or external consumer to quiesce.
- The candidate must still remove legacy registrations and prove that the deferred monitoring
  schedule remains absent after restart while canonical schedules continue to work.
- The candidate must still prove legacy routes are absent, the canonical worker lifecycle works,
  and the production image contains neither Python nor `vendor/last30days`.
- Rollback is a code-release revert only. No database down-migration or data restore is authorized.

## Non-approval

This record does not approve R1B schema/data destruction, production RPO/RTO, service objectives,
source activation, a production deployment or any later product decision. Those gates remain
independent.
