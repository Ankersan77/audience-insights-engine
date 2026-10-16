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
Receipt quota counts accepted plus rejected records. Receipt cost validation remains a
post-acquisition check. Queued workers additionally require the pre-acquisition authorization below;
in-memory manual uploads do not make external requests and retain their existing source checks.

### Acquisition budget admission

Apply migration `0014` before restarting workers. All clients initially have **no acquisition
budget**, so queued adapters cannot execute until an operator supplies one. Do not invent a paid
allowance while onboarding a client. The CLI requires an existing client and `DATABASE_URL`:

```sh
npm run budget -- show --client CLIENT_SLUG
# Explicit example: only zero-cost requests, at most 100 records/10 requests per UTC day.
# Replace CLIENT_SLUG only after the client approves this allowance.
npm run budget -- set --client CLIENT_SLUG --currency DKK --daily-cost-micros 0 --daily-records 100 --daily-requests 10 --enabled true
```

`set` requires every field; use `--enabled false` with the current limits to stop new admissions.
Changes are audited. They neither reset today's usage nor revoke an already-issued authorization.
For an active run, cancel its job/revoke its source as appropriate; cancellation is cooperative and
cannot undo a provider request already sent. The CLI does not expose secrets or source payloads.

Cost is an integer number of micro-units (1,000,000 = one declared currency unit). Currency is fixed
after the first authorization: changing it requires a deliberate ledger migration, never an
implicit FX conversion or fresh allowance. Record and request counts are nonnegative safe integers.
Each synchronous, credential-free adapter `plan(job)` declares `currency`, `maxCostMicros`,
`maxRecords` and `maxRequests`. Missing/invalid plans, disabled budgets, currency mismatches,
source-policy violations and exceeded daily bounds fail before `run()`/credential access.

The database serializes admission across every source for a client, then rechecks current source
rights and the running job. The ledger uses the **UTC admission day**, not provider billing day.
Each attempt permanently consumes its full declared upper bounds for that day, even when it fails,
is cancelled, expires, produces fewer records or costs less. An uncertain outcome is never assumed
free. Each worker retry needs a new authorization; an already-used authorization is never replayed.
Provider success followed by output validation or persistence failure does not trigger reacquisition.
Budget edits retain all authorizations; raising a limit is a new explicit spending decision.

Before **every** network request, including pagination and provider-internal retries, an approved
adapter must call `context.acquisition.authorizeRequest({costMicros, maxRecords})` with defensible
upper bounds, then perform only that bounded request. Use `attemptKey` plus a page/request suffix
for provider idempotency where supported. Credentials require at least one request authorization.
The request gate rejects excess requests/cost/records, closes at completion/failure and checks
cancellation. Do not spawn detached acquisition work. Factories/planning must never perform I/O.
This is a trusted-code contract, **not a network sandbox**: acceptance must demonstrate that a real
adapter meters every request and that provider limits/pricing support its claimed upper bound.
No such live adapter is activated by this change. Unknown/unbounded charges must be rejected.

The old source `costLimit` has no declared currency. It is not silently interpreted as money:
any paid plan with that field present is rejected. A free plan can use a zero source cost limit
with a zero-cost receipt. A paid source requires deliberate removal/migration of the ambiguous
legacy field and explicit currency-budget approval, followed by provider acceptance. Source record
quota is checked against the preflight bound and again against the returned receipt.

The ledger is an authorization ceiling, not measured spend. It must survive backup/restore and must
not be deleted to free capacity. Reconciliation/refunds, monthly allowances, provider rate limits,
live acceptance and an owned-surface budget editor are separate remaining work; do not claim that
this CLI or synthetic tests demonstrate those capabilities.

Run `TEST_DATABASE_URL=... pnpm test:integration` against a dedicated database whose name ends in
`_test`. The suite applies migrations and creates synthetic tenants without truncating tables.
It exercises actual PostgreSQL locks and both revocation/completion orderings. CI supplies an
isolated PostgreSQL 16 service. These tests do not certify production backup or restore.

### Research snapshot conflicts

New decision briefs require a version-1 context snapshot: content digests for the project,
solution, pinned sensing profile, selected evidence (including methodology) and used reviewed
Market Twin records. Digests use canonical JSON key ordering, survive JSONB serialization and
contain no copied strategy text. Existing historical briefs remain readable without a migration;
they are not retrospectively certified by the new checks.

Persistence shares locks on the pinned configuration and on sources, evidence and intelligence,
checks current rights/scope/review/decay, and rechecks temporal eligibility after inserts in case
they waited. On `research-context-changed`, the existing API returns HTTP 409: refresh and rerun
the analysis against current inputs; do not retry saving the old brief unchanged. Artifact and
citations are one transaction and roll back together. Retention locks expired evidence before
scanning/redacting citation copies, so a waiting concurrent insertion cannot escape that scan.

This is an as-of-save guarantee for the inputs actually used. New unrelated evidence does not
rewrite history; a newly published sensing version does not replace a deliberately pinned one.
It does not assert that a historical recommendation remains current forever. Review-time
availability, campaign assessment snapshots and pilot-quality review are separate requirements.

### Evidence-linked campaign pre-flight

The pre-flight form now records an analyst's seven explicit judgments (strategy, audience,
proposition, distinctiveness, cultural permission, channel role and feasibility), their evidence
and accepted Market Twin references, point of view, alternative and recommended decision. Select
the intended market/language when the solution supports several. Generic brand/strategy evidence
does not need a fabricated campaign tag; an existing tag for another campaign excludes that input.
Configured source scope and current rights still apply. This is a single scoped assessment, not
proof of approval coverage across every market of a multinational campaign.

First accept the measurement plan, then save a complete pre-flight. Missing/unusable references,
unresolved findings, disabled ability versions and missing context yield `needs_context`; a
material tension yields `blocked`. Contradictions require a written scoped-decision rationale,
without erasing either source claim. `ready` means ready for a separate authorized reviewer, not
that an AI independently established strategic truth. The server validates traceability and policy;
the reviewer must evaluate the substance of the reasoning.

Campaign approval uses the **latest** pre-flight (not the latest successful one), then rebuilds the
context under locks and compares the frozen campaign/measurement/context basis. If it changed,
reassess against current inputs. The approved revision records its pre-flight artifact ID. Proposals
can replace a measurement plan via “Revise measurement plan”; the replacement starts pending review
and invalidates the old assessment basis. Approved plans cannot silently be replaced. A formal
post-approval amendment workflow remains separate work.

Historical assessments remain unchanged and inspectable. Older structural-only pre-flights are
readable but no longer authorize a new approval. No database migration or provider activation is
required for this upgrade. Model-authored analysis, complete live/post contextual assessments,
metric provenance and actual pilot quality are not certified by this manual workflow.

### Source-backed live/post readback

1. Configure an approved `first_party_aggregate` source and bind its alias in the active solution.
   Enable `live-campaign-intelligence` and/or `post-campaign-learning` version `1.0.0`.
2. In Evidence onboarding, select that source and expand “First-party aggregate observation”.
   Import baseline and result separately. Supply metric key/value/unit, cohort, aggregation and
   completed half-open `[periodStart, periodEnd)` windows, plus methodology, universe, limitations,
   market/language and exactly one campaign ID. Universe must match the approved metric population.
   This is explicit human transcription; the operator must verify it against the source report.
   Ordinary CSV/text upload does not magically extract numerical observations.
3. In an active/completed campaign, select one baseline and result observation for each planned
   metric. The chooser lists up to 1,000 recent eligible tenant observations. Core validates all
   selections again and refuses missing, suppressed, wrong-scope or incompatible inputs.
4. Inspect values, differences, targets, materiality, windows, source references and the frozen
   campaign/measurement/Market Twin basis in the saved readback. `ready` here means numerical
   reconciliation is ready for interpretation, not strategic endorsement or causal evidence.

`POST /api/campaigns/:id/assessment` uses `metricSelections` entries containing `metricKey`,
`baselineObservationId` and `resultObservationId` strings. Free-form `baseline`, `current` or
`observedResults` maps are rejected; a linked report ID cannot substantiate arbitrary numbers.
The aggregate upload body uses `aggregate: { metricKey, value, unit, aggregation, cohortSize,
periodStart, periodEnd }` alongside the existing source/method/scope fields. Replaying the same
transcription does not add duplicate observations. No live external request or new schema migration
is needed. The existing minimum-cohort setting is applied before retention.

Different sources/methods, missing dimensional metadata, unequal count/sum windows and disagreement
with the approved baseline require explicit remediation rather than guessed conversion. A source
revocation or expiry suppresses copied values/deltas when read; scheduled retention also removes
them from persisted assessment payloads, retaining minimal lineage. The numeric join deliberately
does not emit a generic learning. Contextual interpretation and learning review remain required.

After building, run `TEST_HTTP=1 TEST_DATABASE_URL=... pnpm test:integration` to exercise the actual
web server as well. The suite starts a temporary loopback-only production-build process against
the test database with synthetic identities and real opaque server sessions. It verifies briefing authentication, role checks,
tenant isolation, review transitions and the server-rendered viewer surface, then stops the
process. CI runs this variant after the production build. This is not an external OIDC login test.

## Session and membership operations

Apply migration `0013` before deploying this release. Old signed-role session cookies are rejected;
users must sign in again. New cookies contain a random 256-bit token, never identity or permission
claims. PostgreSQL retains only its SHA-256 hash, tenant/user reference, creation, absolute
eight-hour expiry and revocation time. Each request joins the current tenant membership and user;
role changes take effect on the next request. Already-running actions are not cancelled by this
check. Deleting membership cascades its sessions, so re-granting access cannot revive old tokens.

OIDC authenticates identity but never creates or restores membership. A trusted operator with
database access explicitly provisions the provider's exact subject, not a display name or email:

```sh
pnpm access grant --client CLIENT_SLUG --subject OIDC_SUBJECT --role owner --create-client-name "Client name"
pnpm access grant --client CLIENT_SLUG --subject OIDC_SUBJECT --role reviewer
pnpm access revoke --client CLIENT_SLUG --subject OIDC_SUBJECT
```

The first command creates a tenant only when the explicit name flag is supplied. Subsequent grants
change the tenant role; revocation removes membership and its sessions, not research data. Each
changed grant/revoke is audited atomically as an operator action. The CLI reads `DATABASE_URL`
from the environment or `.env.local`; verify the deployment target before running it. No user
or membership is automatically provisioned by a login. Re-granting requires an explicit command.

Use HTTPS, a strong `SESSION_SECRET` of at least 32 characters for ten-minute OIDC flow cookies,
and `APP_ORIGIN` set to the public web origin. A hosting proxy must sanitize Host/forwarded headers.
Cookie-authenticated API writes without the matching Origin are rejected, including logout. The
owned UI signs out via POST, which revokes the stored token before clearing the browser cookie.
The canonical worker removes expired/revoked session rows, but enforcement does not depend on
worker availability. Never log token values, flow cookies or provider error payloads.

## Scheduled review packets

An administrator enables weekly, monthly and/or quarterly rhythms under Market Pulse. A bound
sensing profile is required; saving creates a new immutable solution version. Portable packages
carry these rhythms without tenant IDs. Omitted rhythms are disabled, including in older packages.

The canonical scheduler generates packets every 15 minutes, after monitoring reconciliation and
qualification. Windows are UTC, end-exclusive and closed before generation. The first window
begins at solution activation; later windows follow Monday/month/quarter boundaries. Each tick
catches up at most 12 windows per cadence and active solution. A persisted window end is the
restart checkpoint, and concurrent deliveries cannot duplicate its artifact. Superseded solutions
stop scheduling: a new version does not reconstruct missing history under old configuration.

Packets contain references and bounded coverage summaries, not copied source excerpts. Monthly
reviews require current audience and positioning briefs; quarterly reviews expose stale context
and pending learning. They are deterministic review indexes, not expert narrative synthesis.
Missing/failed/pending monitoring and absent receipts produce explicit gaps. One receipt proves
a source check, not continuous coverage or representativeness. Reviews are owned-surface only,
have named reviewers, reject incomplete/unavailable evidence and never promote a signal or learning.
Historical acceptance remains visible when source availability later changes. Late evidence does
not silently rewrite a packet; explicit revised-packet generation remains an open work item.

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

