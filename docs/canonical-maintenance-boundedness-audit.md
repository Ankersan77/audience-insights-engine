# Canonical maintenance boundedness audit

## Document status

| Field | Value |
|---|---|
| Status | Evidence/design input; approved boundaries promoted to Blueprint 2.1.0 and Roadmap R1A1b |
| Evidence snapshot | Repository working tree reviewed 2026-10-17 |
| Decision resolution | Approved 2026-10-18; see `docs/r1a1b-bounded-maintenance-decision.md` |
| Scope | Canonical session cleanup, evidence retention, copied-artifact redaction, stale acquisition reconciliation and queued acquisition dispatch |
| Out of scope | Implementing code or migrations, changing product scope, changing a capability release state, or claiming production readiness |

This audit records observed bounded-resource gaps and the design input used for the R1A1b decision.
It does not independently amend `BLUEPRINT.md`, `ROADMAP.md`, the capability register, or any locked
product decision. The approved bounds now live in Blueprint 2.1.0, Roadmap R1A1b and the linked
decision record; if this audit conflicts with them, those canonical records win.

The relevant gates remain:

- the Blueprint requires bounded inputs, outputs, nesting and deadlines, and says code presence or a
  passing synthetic test is not production evidence;
- the Roadmap cross-cutting definition of done requires bounded resource, deadline and cost
  behaviour, retry semantics, PostgreSQL integration evidence, rollback instructions and
  capability-register alignment;
- R1A1 requires canonical queues to register, execute and drain independently of the legacy queue;
- the current capability register keeps `canonical-maintenance-scheduler` at `designed` and already
  records that session cleanup and high-fan-out artifact retention need a schema-backed bounded
  continuation mechanism.

No finding below is authority to advance that state.

## Executive finding

Canonical maintenance is count-bounded at a few top-level selectors, but it is not resource-bounded
as a whole. One maintenance execution may still delete, load, transform or update an unbounded number
of dependent rows and an unbounded number of JSON bytes inside one transaction. PgBoss job expiry is
not a cancellation mechanism for JavaScript or SQL work, so the five-minute queue setting does not
create a five-minute execution bound.

The smallest design that closes the gap without creating a generic workflow system is:

1. one purpose-built durable retention-work table for evidence with high-fan-out dependants;
2. bounded, resumable phases with fixed row, byte and wall-clock budgets;
3. bounded self-advancing deletion for sessions and simple lifecycle rows;
4. targeted indexes for every due-work selector;
5. fail-closed read projection while durable artifact cleanup is pending;
6. an O(1) source-revocation control-plane transition followed by bounded cleanup;
7. additive result fields that expose backlog without treating expected continuation as failure.

The batch sizes, payload limits, revocation response semantics and read-projection obligation were
approved on 2026-10-18. Implementation, installation evidence and the remaining open operational
decisions are not implied by that approval.

## Current failure modes

### 1. Session purge is unbounded

`src/db/queries/auth_sessions.ts` currently issues one `DELETE` for every expired or revoked session
and materializes every deleted token hash through `RETURNING`. The existing index covers
`expires_at`, but there is no corresponding `revoked_at` index. An installation-sized backlog can
therefore create unbounded row locks, write-ahead log volume and returned result memory in a single
call.

The operation is idempotent, but idempotency does not bound its resource use.

### 2. The evidence limit does not bound dependent work

`src/db/queries/retention.ts` selects at most 1,000 evidence rows, but each selected row can have an
unbounded number of dependants:

- all matching quantitative observations are deleted and returned;
- every qualitative theme for every affected client is loaded, including its evidence-ID array;
- every matching citation is updated;
- every research artifact for every affected client is loaded with its JSON payload and evidence-ID
  array, then inspected and possibly updated sequentially;
- up to 1,000 evidence rows are updated one by one;
- collection and intelligence expiry each add a separate batch of up to 1,000 rows;
- one audit insert is issued per affected client.

All of this occurs in one transaction. The top-level evidence count therefore does not bound rows,
bytes, CPU, transaction duration or lock duration. Selecting `source_content` for the whole evidence
batch also makes input bytes unbounded even before artifact payloads are considered.

### 3. Artifact redaction has an exposure gap if it is merely made asynchronous

Research artifacts retain copied, frozen payloads. `listDecisionBriefs` currently returns stored
`payload_json` directly; it does not project expired or revoked evidence out at read time. Campaign
code has a narrower read-time expiry projection, but that behaviour is not a universal artifact
boundary.

Splitting redaction into bounded asynchronous batches without also adding fail-closed output
projection would leave copied excerpts or interpretations visible while cleanup is pending. Durable
cleanup and read-time safety solve different problems; one cannot substitute for the other.

### 4. Queue expiry is not an execution deadline

`src/workers/canonicalMaintenance.ts` configures `expireInSeconds: 300`, but there is no SQL statement
timeout, lock timeout, per-stage time budget or cooperative abort signal. A blocked database query or
PgBoss send can continue beyond the queue expiry. Since stages run sequentially, a slow early stage
can also starve acquisition reconciliation or dispatch.

### 5. Source revocation performs unbounded cleanup synchronously

`src/db/queries/sources.ts` currently revokes a source and, in the same request transaction, updates
and returns every queued or running acquisition job, every live/candidate/quarantined evidence row
and every corresponding collection. The HTTP route then invokes retention synchronously.

Consequently, bounding only the scheduled worker would not satisfy the cross-cutting requirement.
The control-plane revocation itself must have a fixed cost, while use and persistence remain
fail-closed during deferred cleanup.

### 6. Acquisition dispatch is count-bounded but not fully operationally bounded

Queued and stale acquisition selectors clamp their row count, and queue payloads contain only a
database job ID. Those are sound existing boundaries. Remaining gaps are:

- no partial index supports oldest queued work;
- no partial index supports stale-running selection;
- sequential `boss.send` calls have no enforced statement or wall-clock deadline;
- results do not distinguish attempted, dispatched and remaining work;
- reaching a batch limit is not observable as bounded backlog;
- the 24-hour singleton interval can delay recovery after a queue/database state split and therefore
  needs an explicit liveness test rather than an assumption.

### 7. Simple capped selectors are non-deterministic and may contend

Collection and intelligence expiry have limits but no stable order or `SKIP LOCKED`. Concurrent
maintenance or an administrator-triggered retention call can block rather than share work safely.
Stale reconciliation is capped but runs row transitions sequentially and lacks its supporting
partial index.

## Smallest additive design for decision

### Design boundary

The proposal deliberately does not add a generic scheduler, workflow engine, event-sourcing layer or
new queue per phase. PgBoss remains the scheduler. PostgreSQL holds only the minimum durable marker
needed to resume high-fan-out evidence cleanup safely.

### A. One evidence-retention work table

Proposed table shape:

```sql
create table canonical_retention_work (
  evidence_id integer primary key
    references canonical_evidence(id) on delete cascade,
  phase text not null default 'observations'
    check (phase in ('observations', 'themes', 'citations', 'artifacts', 'finalize')),
  cursor_id integer not null default 0 check (cursor_id >= 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index canonical_retention_work_fairness_idx
  on canonical_retention_work(updated_at, evidence_id);
```

`client_id` need not be duplicated in this operational table. Every operation joins through the
tenant-owned canonical evidence row and applies the tenant predicate when a client-scoped invocation
is requested. Avoiding a duplicated tenant key also avoids a second source of truth.

A maintenance run would insert at most a fixed number of due evidence IDs not already present. Work
selection would be oldest-update first with `FOR UPDATE SKIP LOCKED`. After each bounded chunk,
`updated_at` moves forward so one high-fan-out item cannot permanently starve newer work.

The proposed phases are intentionally specific:

1. `observations`: delete at most the phase row limit through a CTE selecting observation IDs;
2. `themes`: delete at most the phase row limit where the evidence-ID array contains the evidence;
3. `citations`: update at most the phase row limit of citations not already redacted;
4. `artifacts`: select a fixed number of artifacts with `id > cursor_id`, redact copies, then advance
   the cursor even when a payload required no change;
5. `finalize`: lock and revalidate the evidence row, write the minimal tombstone, emit bounded audit
   metadata and remove the work row.

Each phase transition resets `cursor_id` where appropriate. Processing a work chunk and advancing its
marker must commit atomically. A crash before commit repeats the same chunk; a crash after commit
resumes from the durable marker.

Evidence should not be changed to lifecycle `expired` when the work row is first inserted. Keeping
the current lifecycle until finalization lets a rolled-back old binary see and finish the same due
row. Current `expires_at` and source-policy checks must continue to block new use. If an old binary
tombstones the evidence while a work row exists, the new worker must still finish dependent cleanup
idempotently and then remove the marker.

### B. Bounded operations that do not need cursor rows

Sessions, collections and decayed intelligence are self-advancing: a successfully deleted or
transitioned row no longer matches the due predicate. A separate cursor table would add state and
could skip newly due rows without improving correctness.

For sessions, use a CTE that selects at most `limit + 1` token hashes under `FOR UPDATE SKIP LOCKED`,
deletes at most `limit`, and returns only a count. The extra row supplies `batchFull` without an
unbounded count query. Collections and intelligence should use the same `limit + 1`, stable
`(due_at, id)` order and bounded update pattern.

The capability-register limitation should only be revised after implementation and evidence. This
audit does not revise it. If governance requires a literal session checkpoint despite the
self-advancing design, it should be telemetry-only and must not control row eligibility.

### C. Explicit run and stage budgets

The following are proposed starting values, not approved product constants:

| Boundary | Proposed starting value |
|---|---:|
| Maintenance handler wall budget | 240 seconds, leaving 60 seconds below PgBoss expiry |
| Session rows per run | 500 |
| New evidence work rows discovered per run | 100 |
| Retention work chunks per run | 20 |
| Lightweight dependant rows per chunk | 100 |
| Artifact rows per chunk | 10 |
| Collections per run | 250 |
| Intelligence records per run | 250 |
| Stale acquisitions per run | 100 |
| Acquisition dispatch attempts per run | 100 |
| SQL statement timeout | 10 seconds |
| SQL lock timeout | 1 second |
| Proposed artifact JSON maximum | 256 KiB |
| Proposed evidence references per artifact | 100 |

Each stage needs its own time slice as well as the overall deadline, so retention cannot consume the
entire run and starve dispatch. Reaching a limit or deadline with valid backlog is successful
continuation, not an error and not a PgBoss retry. Unexpected failures retain the current stable,
redacted stage codes and stage isolation.

A JavaScript `Promise.race` alone is not an adequate database timeout because the underlying query
continues. Drizzle transactions should set local statement and lock timeouts. PgBoss calls need a
reviewed connection-level statement-timeout strategy or another mechanism that cancels the database
statement, not merely the caller's wait.

### D. Additive result contract

Existing summary fields can remain while internal results gain bounded continuation metadata:

```ts
type BatchProgress = {
  processed: number;
  batchFull: boolean;
};

type DispatchProgress = {
  attempted: number;
  dispatched: number;
  batchFull: boolean;
};
```

The maintenance result should additionally expose aggregate `batchFull`, elapsed time and deferred
stage names. Logs remain content-free. Backlog is not an exact remaining count and must not require
an unbounded `COUNT(*)`.

### E. O(1) source revocation plus bounded cleanup

The smallest control-plane change is a nullable `source_connection.revoked_at` timestamp. Revocation
would update one source row and record its audit event. New acquisition, evidence use and persistence
remain blocked immediately by source policy.

Retention discovery would treat evidence and collections as due when their own expiry is due or the
owning source is revoked. A bounded canonical-maintenance stage would cancel queued/running jobs for
revoked sources and insert idempotent receipts. Dispatch selection must exclude revoked/unavailable
sources. In-flight completion already rechecks current source policy; that invariant must remain.

The administration API would no longer be able to promise exact immediate affected-row counts. A
compatible response could retain existing fields as nullable and add `cleanupPending: true`; a
versioned response may instead explicitly report that revocation is recorded and cleanup is pending.
This semantic choice requires approval.

### F. Fail-closed artifact projection

Before bounded persistent cleanup is enabled, every artifact DTO exposed to web or MCP surfaces must
intersect the artifact evidence IDs with current expired or revoked evidence and run the common
redaction projection. The response must mark the basis stale or expired and must not expose copied
content that durable cleanup intends to remove.

This projection is not permission to stop persistent cleanup. It is the immediate safety boundary
while durable work progresses. Artifact list endpoints also need an explicit result limit or cursor;
otherwise the read path itself remains unbounded.

### G. Bound one artifact

Row batching does not bound memory if one JSON payload can be arbitrarily large. A named maximum
serialized payload size and evidence-reference cardinality must therefore be approved and enforced
by the central artifact persistence service.

Database `CHECK` constraints should be added only after installation inventory identifies existing
oversize rows. `NOT VALID` avoids an initial table scan but still applies to new writes, including
writes from a rolled-back binary; it is not automatically rollback-compatible.

## Proposed supporting indexes

Names are illustrative but deliberately specific enough for migration review:

```sql
create index auth_session_expiry_token_idx
  on auth_session(expires_at, token_hash);

create index auth_session_revoked_token_idx
  on auth_session(revoked_at, token_hash)
  where revoked_at is not null;

create index canonical_evidence_retention_due_idx
  on canonical_evidence(expires_at, id)
  where lifecycle in ('candidate', 'live', 'quarantined');

create index evidence_collection_retention_due_idx
  on evidence_collection(expires_at, id)
  where lifecycle in ('candidate', 'live', 'quarantined');

create index intelligence_record_decay_due_idx
  on intelligence_record(decay_at, id)
  where decay_at is not null and lifecycle in ('candidate', 'live');

create index quantitative_observation_evidence_id_idx
  on quantitative_observation(evidence_id, id);

create index citation_evidence_id_idx
  on citation(evidence_id, id);

create index qualitative_theme_evidence_ids_gin_idx
  on qualitative_theme using gin(evidence_ids);

create index research_artifact_evidence_ids_gin_idx
  on research_artifact using gin(evidence_ids);

create index source_acquisition_job_queued_idx
  on source_acquisition_job(id)
  where status = 'queued';

create index source_acquisition_job_running_started_idx
  on source_acquisition_job(started_at, id)
  where status = 'running' and started_at is not null;

create index source_acquisition_job_revoked_source_cleanup_idx
  on source_acquisition_job(client_id, source_connection_id, id)
  where status in ('queued', 'running');

create index canonical_evidence_revoked_source_cleanup_idx
  on canonical_evidence(client_id, source_connection_id, id)
  where lifecycle in ('candidate', 'live', 'quarantined');

create index evidence_collection_revoked_source_cleanup_idx
  on evidence_collection(client_id, source_connection_id, id)
  where lifecycle in ('candidate', 'live', 'quarantined');
```

If `revoked_at` is approved:

```sql
create index source_connection_revoked_idx
  on source_connection(revoked_at, id)
  where revoked_at is not null;
```

The existing expiry-only session index should not be dropped in the first migration. Remove a
redundant index only after installation query evidence shows the replacement is used and the change
has its own rollback review.

## Migration placement options

### Preferred placement

Create one isolated additive forward migration at the next available number—currently `0019` in the
reviewed snapshot—and place it before any destructive R1B contraction migration. If another approved
migration takes that number first, use the next number. Do not rewrite migrations `0001`–`0018`, and
do not combine maintenance boundedness with legacy-table removal.

The first migration may contain:

- `canonical_retention_work` and its fairness index;
- `source_connection.revoked_at` only if the revocation decision is approved;
- the due-work, dependent-row and acquisition indexes.

Payload and reference-count checks should be a later migration after inventory and all active writers
enforce the approved limits.

### Index-build choice

Large GIN and partial indexes may require `CREATE INDEX CONCURRENTLY`. Whether the configured Drizzle
migrator permits that outside a transaction must be verified rather than assumed. The two acceptable
deployment choices are:

1. normal additive indexes in a measured maintenance window for installations proven small enough;
2. an operator-controlled, recorded pre-deploy concurrent-index step followed by the schema migration
   and verification.

An undocumented ad-hoc production index is not an acceptable third path.

## Compatibility and rollback risks

- Old binaries ignore an additive work table, nullable column and indexes.
- New binaries must fail readiness against a database that lacks the required migration.
- Marking evidence lifecycle `expired` at work discovery would strand cleanup after an application
  rollback because the old selector excludes expired rows; the proposal therefore delays that
  transition until finalization.
- A rolled-back old worker can complete a due row without consulting the work table. New code must
  recognize that state and finish or retire the remaining work idempotently.
- Pending bounded work can revert to the old unbounded execution path after rollback. The operator
  must either drain work before rollback, use the documented maintenance kill switch, or deploy a
  forward corrective release. A down migration is not incident response.
- `NOT VALID` checks still constrain new writes and may break an older writer. Add them only after the
  rollback window and writer inventory are explicitly accepted.
- Changing source revocation from exact synchronous counts to pending cleanup changes an API
  expectation even if the database change is additive.
- GIN index construction may create deployment load and lock risk. Synthetic integration tests are
  not installation sizing evidence.
- Bounded persistent redaction without fail-closed read projection is a regression, not a safe
  partial rollout.

## Required verification

### Unit and query-contract tests

- limits are clamped to approved maxima;
- `limit + 1` produces `batchFull` without an exact backlog count;
- expected backlog does not throw or consume PgBoss retries;
- unexpected failures use only stable redacted error codes and later stages still execute;
- elapsed/deferred metadata contains no content or tenant data;
- artifact payload and evidence-reference boundaries accept exactly-at-limit and reject one-over;
- no canonical maintenance module imports monitoring, briefing or legacy queue code.

### PostgreSQL integration tests

- more than one session batch, including expired and revoked rows; repeated calls drain it while
  preserving non-due rows;
- two concurrent session purgers do not process the same row or block indefinitely;
- one expired evidence item with more observations, themes, citations and artifacts than one phase
  batch; repeated runs advance durable phase/cursor state and tombstone only after sanitization;
- a transaction failure before marker commit repeats the chunk, while a failure after commit resumes
  from the next cursor;
- concurrent retention workers share work through `SKIP LOCKED` and never cross tenant scope;
- brief creation or review racing finalization cannot persist a new usable artifact from expired or
  revoked evidence;
- output projection is already redacted before persistent cleanup finishes;
- existing oversize payload/reference inventory is reported before constraint validation;
- collection and intelligence batches are oldest-first and eventually drain without starvation;
- more than 100 queued, stale and revoked-source acquisition jobs produce bounded progress and drain
  over subsequent runs without duplicate external acquisition;
- revoked-source cleanup uses the tenant/source access paths for acquisition jobs, canonical
  evidence and evidence collections rather than scanning whole tables;
- required index definitions are present. Avoid brittle assertions about a particular planner cost.

### Real PgBoss lifecycle test

The existing canonical runtime integration case should be extended only after the design is approved
to show that:

- a maintenance job reports bounded backlog without failing;
- a subsequent job resumes durable work;
- stage deadlines do not prevent later stages from receiving their reserved budget;
- acquisition, retention, session purge, synthesis maintenance and graceful drain remain green;
- legacy and monitoring queues remain absent from canonical composition.

These tests remain synthetic operational evidence. They do not satisfy installation sizing, live
source, recovery or production-support gates.

## Decision resolution and remaining gates

| Decision | Resolution |
|---|---|
| Per-run row, chunk and wall-time budgets | Approved at the values in the budget table above |
| Maximum artifact JSON bytes | Approved at 256 KiB (262,144 UTF-8 bytes) |
| Maximum evidence references per artifact | Approved at 100 references |
| Source revocation response | Approved as immediate O(1) revocation with `cleanupPending` |
| Fail-closed artifact projection | Approved as mandatory for every web/MCP artifact DTO |
| SQL timeout strategy | Approved 10-second statement and 1-second lock timeouts, enforced by the database and covered by startup/compatibility tests |
| Cleanup service objective | Open; owner must define it from privacy/source-rights obligations |
| Index deployment method per installation | Open; select a measured maintenance window or recorded concurrent pre-deploy step from installation evidence |

The approved decision permits R1A1b implementation; it does not prove that canonical maintenance is
production-bounded. Until the required implementation, installation and external evidence passes,
only lifecycle/isolation have synthetic proof and R1A2 remains closed.
