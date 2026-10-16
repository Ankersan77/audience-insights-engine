# Operations and recovery runbook

## Supported deployment shapes

Market Research supports managed, client-owned, and hybrid deployment. In every shape PostgreSQL
is the system of record, the web and worker processes share the same release version, credentials
stay in the deployment secret store, and connector adapters expose only opaque credential
references to Core.

## Release

1. Run `bash verify.sh` in a clean checkout.
2. Review generated migrations and take a restorable database backup.
3. Apply migrations once with `pnpm db:migrate` before starting the new web and worker release.
4. Start the web service and verify `GET /healthz`.
5. Start the worker, verify queue connectivity, and confirm no circuit is unexpectedly open.
6. Confirm `/workspace` shows the expected tenant and canonical record counts.
7. Activate live connectors only if their external-validation entries are verified.

Canonical monitoring creates durable database jobs and dispatches their IDs through pg-boss. The
worker claims each job once, resolves its adapter through `productionRegistry.ts`, runs bounded
retry only for classified transient failures, persists canonical evidence and a redacted receipt
atomically, and reconciles stale leases. Unregistered adapters and unavailable credentials fail
closed and mark the source degraded. Queued or running jobs may be cancelled from `/monitoring`;
any later adapter output is discarded rather than retained.

Source connections are not operational until their policy envelope is complete. Claim-time checks
enforce health, rights expiry, commercial-use permission, data classification, market/language and
lookback. Receipt-time checks enforce record quota and, when configured, a reported acquisition
cost. Missing cost reporting is a failure when a cost limit exists. Revoking a source from
`Sources & Setup` cancels queued/running jobs, marks evidence and collections due immediately, applies
canonical tombstoning, and records a tenant-scoped governance audit. Re-activation requires a new
reviewed source configuration; revocation is not toggled away casually.

Manual uploads and worker results recheck the current source policy inside the persistence
transaction. Claims, completion and failures lock the source before the job, matching revocation's
lock order. Cancellation locks the job; a late completion cannot overwrite its terminal state.
Receipt quota counts accepted plus rejected records. Receipt cost validation is a post-acquisition
check, not a guarantee that provider spend was prevented; shared budget reservation remains open.

Run `TEST_DATABASE_URL=... pnpm test:integration` against a dedicated database whose name ends in
`_test`. The suite applies migrations and creates synthetic tenants without truncating tables.
It exercises actual PostgreSQL locks and both revocation/completion orderings. CI supplies an
isolated PostgreSQL 16 service. These tests do not certify production backup or restore.

## Quality and release evidence

Use `/evaluation` to record human scorecards and per-client external validation evidence. A
scorecard records the benchmark case class, exact artifact reference, rubric version, dimension
scores, limitations, reviewer, remediation lineage and a durable review reference. The service
computes the outcome; reviewers cannot manually label a failing scorecard as passed.

Research-quality, Brand Lift, monitoring and production-operations gates require a passing
decision-brief, study-report, monitoring-signal or recovery-exercise scorecard respectively. Gate
evidence with an expiry is treated as `needs_context` after expiry. Never use a repository test or
an unreferenced verbal approval as external release evidence.

## Backup and restore exercise

The production owner chooses and documents the PostgreSQL-native backup mechanism. A valid
exercise restores into an isolated database, applies no ad-hoc schema changes, starts the same
release against the restored database, verifies tenant counts and representative artifacts, and
records start time, finish time, recovery point, recovery duration, operator, and evidence link.
Never point a restore test at production or reuse production connector credentials.

## Failure handling

- Acquisition uses bounded retry only for classified transient failures; permission and policy
  failures are not retried.
- Idempotency keys prevent duplicate external work and duplicate canonical retention.
- A source circuit opens after its configured failure threshold and remains visibly degraded.
- Cancellation is cooperative and produces a receipt; it never deletes already reviewed evidence.
- A no-change monitoring run is a successful, visible outcome, not missing telemetry.
- Failed, partial, revoked, or quota-limited sources never silently yield a complete brief.

## Rollback

Application rollback means deploying the preceding compatible release and leaving additive schema
changes in place. Destructive down migrations are not an incident response. If a migration is
defective, disable affected writes, restore from the verified backup when data integrity requires
it, and ship a forward corrective migration.

## Incident priorities

- **P0:** cross-client exposure, credential/raw-payload leakage, or consumer identity retention.
- **P1:** evidence lineage corruption, unsupported causal/Brand Lift claim, or unrecoverable loss.
- **P2:** degraded source, delayed monitoring, or incomplete non-critical artifact.

For P0/P1: disable the affected path, preserve redacted audit evidence, rotate exposed credentials
outside the application, identify affected client scope, and require explicit review before
re-enabling. Do not paste raw provider payloads or personal data into tickets or logs.

