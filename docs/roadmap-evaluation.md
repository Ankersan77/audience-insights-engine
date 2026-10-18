# Roadmap evaluation and execution corrections

> Historical note: this evaluation explains the pre-Blueprint-2.0 platform roadmap. It was
> superseded by `BLUEPRINT.md` 2.0.0 and the replacement `ROADMAP.md` on 2026-10-17. Its implementation
> observations remain useful evidence, but its capability scope and sequencing are not current.

Date: 2026-10-16  
Updated: 2026-10-17
Blueprint: `BLUEPRINT.md` v1.0.0  
Evaluated baseline: commit `c767425`

## Verdict

The roadmap has the right product boundary and end state. Its strongest decisions are the
trend-first/people-blind boundary, provider-neutral adapters, explicit intelligence states,
governed learning, and refusal to infer causal Brand Lift from weak designs.

The original sequencing is not optimal as an implementation plan. It is horizontally organized:
large contracts and data foundations precede the first useful product slice, while security,
operations, evaluation, and second-client proof arrive too late. It also mixes work that can be
completed in this repository with gates that require client permissions, live datasets, deployment
infrastructure, and qualified human review.

## Baseline gaps

| Area | Baseline | Required correction |
| --- | --- | --- |
| Tenancy | Brand-centric records and global roles | Client scope, membership, fail-closed access, and direct tenant keys on canonical records |
| Evidence | Provider-shaped legacy rows with optional handles | Ephemeral acquisition, minimization, canonical evidence, rights/method/freshness, lifecycle |
| Market Twin | No canonical graph or transition policy | Typed records, relationships, contradictions, supersession, governed promotion |
| Abilities | One legacy count-based draft path | Versioned manifests, evidence requirements, deterministic quality gates, decision briefs |
| Campaigns | Not represented | Versioned lifecycle, measurement readiness, pre/live/post assessments |
| Measurement | Not represented | Metric dictionary, design classifier, Brand Lift guardrails and reproducible analysis |
| Monitoring | Run queue only | Sensing profiles, qualification, no-change receipts, owned-surface briefings |
| Packaging | Single deployment assumptions | Redacted profiles, version pins, migration contracts, second-client fixture |
| Security/operations | Mostly deferred to Phase 8 | Enforce tenant, injection, retention, idempotency, audit, and recovery from the first slice |

## Adopted execution model

The numbered roadmap outcomes remain canonical, but implementation uses vertical slices:

1. **Control-plane slice:** tenancy, profiles, authorization, versioning, audit, and additive
   migration.
2. **Evidence slice:** adapter SDK, ephemeral acquisition, minimization, canonical evidence,
   citations, and three provider-neutral fixture adapters.
3. **Intelligence slice:** Market Twin resolution, contradictions, transition policy, onboarding,
   and evidence selection.
4. **Decision slice:** the first four abilities and decision briefs in the owned product surface.
5. **Campaign and measurement slice:** campaign lifecycle, pre/live/post analysis, measurement
   plans, study classification, and Brand Lift guardrails.
6. **Monitoring and learning slice:** sensing, qualification, briefings, candidate learning, and
   review.
7. **Packaging and hardening slice:** redacted export/import, second-client proof, recovery,
   observability, security tests, and deployment documentation.

Every slice includes contract tests, tenant/security tests, operational failure tests, and an owned
product-surface proof. No phase may postpone those concerns to Phase 8.

## Gate separation

### Repository-verifiable gate

Code, migrations, deterministic fixtures, automated tests, clean builds, threat controls,
runbooks, and reproducible analysis can be completed and evidenced in this repository.

### External validation gate

The following cannot be truthfully self-certified by code and remain open until named evidence is
attached:

- approved sources and representative data for D4WN's Danish positioning/competitor pilot
  (client and brief named 2026-10-17; no existing data);
- source permissions and licensed-provider agreements;
- live connector credentials and provider acceptance tests;
- cohort, suppression, and retention values approved for the pilot;
- qualified market-research and Brand Lift reviewers;
- human scorecards on real briefs and shadow-mode signals;
- production backup/restore exercise and deployment ownership.

The application must display these as `unverified` or `needs_context`, never infer that they passed.

## Repository execution result

Implementation spans all eight phases, but repository completion is not yet established. The
2026-10-16 follow-up audit found missing runtime enforcement and integration coverage despite
passing unit tests. The owned application currently exposes:

- durable Ask / Projects workrooms that bind decision context, market/language scope and governed
  research artifacts without weakening tenant boundaries;
- client-scoped evidence onboarding, Market Twin review and decision briefs;
- versioned campaigns with a ready pre-flight approval gate, descriptive live readback and
  evidence-linked post-campaign assessment;
- separate measurement-plan and study review, including deterministic Brand Lift language gates;
- a candidate-learning path that requires reviewer promotion before it becomes durable learning;
- versioned sensing and solution profiles, tenant-scoped manual/durable scheduling, and
  tenant-neutral checksum-verified configuration import/export; and
- owner, administrator, researcher, reviewer and viewer permissions enforced server-side.

The clean verification gate covers source-of-truth checks, generated route types, TypeScript,
lint, deterministic tests, migration drift and a production Webpack build. This is implementation
evidence, not a substitute for the open external gates below.

### Reopened implementation gates

- Source revocation previously allowed manual uploads and raced with worker completion. Source
  locks and policy checks now protect both persistence paths. Dedicated PostgreSQL integration
  cases verify both completion/revocation orders, cancellation, current rights, scope, tenant
  isolation and credential-reference projection. All migrations were applied to an empty
  PostgreSQL 16 test database; production migration and recovery remain unverified.
- Research orchestration now resolves the active tenant solution, project decision and scope,
  bound sensing configuration and applicable reviewed Market Twin records with current supporting
  evidence. New briefs retain versioned context references and canonical digests for project,
  solution, bound sensing, used intelligence and used evidence, including methodology. Persistence
  locks and revalidates those inputs, current source permissions and evidence eligibility; expiry
  is checked again after potentially blocked inserts. Retention locks evidence before scanning
  citation copies, preventing a concurrent save from escaping redaction. Database tests cover
  changed/withdrawn context, source rights, concurrent edits and expiry during blocked persistence.
  Historical artifacts without this snapshot remain readable, but cannot be newly persisted as
  ready. Context evidence cannot substitute for an
  ability's primary evidence requirements. Invalid provider output and self-approved causal
  classifications fail closed. An optional bounded Responses transport and a versioned,
  ability-specific synthesis prompt now have synthetic HTTP/orchestration coverage. It has no
  default model, implicit credentials, retry or production activation. Selected text is no longer
  silently clipped before synthesis. Durable, separate synthesis spend admission is now implemented
  through a provider-neutral wrapper and PostgreSQL ledger: finite currency/request reservations,
  one-use dispatch, versioned budget revocation, deadline checks, atomic audit and operator crash
  reconciliation have synthetic unit/database coverage. A separate five-minute pg-boss maintenance
  queue now drains expired work across days in bounded tenant batches, skips busy tenant locks and
  rolls back status/audit together on failure. Partial deadline indexes and all-day backlog counts
  support recovery; synthetic tests cover actual queue execution, concurrency and write contention.
  This does not reconcile provider invoices or prove production scheduler availability.
  The production composition root now binds
  the authenticated tenant to explicit server configuration, exact processing/quality acceptance
  scopes, approved source IDs and the budget wrapper. Locked checks repeat at reservation, dispatch
  and completion; current rights, evidence/methods, reviewed context and revoked configuration/gates
  can stop release. Synthetic factory/adapter/database tests and absent-binding HTTP tests pass.
  Unconfigured clients still have no provider. Actual metering and live-provider HTTP verification
  remain open, alongside approved processing, live provider acceptance and qualified
  human benchmarks. See `docs/synthesis-provider-acceptance.md`; adapter code and
  synthetic tests alone do not satisfy the expert-research requirement.
- Weekly/monthly/quarterly review packets now have opt-in solution configuration, closed UTC
  windows, bounded restart catch-up, durable idempotent artifacts, tenant-scoped owned-surface
  delivery and atomic accept/reject audit. Missing coverage is not no-change, and unavailable
  evidence prevents acceptance. The packets deliberately index existing evidence and work; they
  do not yet provide expert narrative synthesis. Urgent alert delivery, late-evidence revision
  workflows and live shadow-mode quality proof remain open.
- Queued acquisition now requires an explicitly enabled, client-wide daily budget and a
  synchronous adapter upper-bound plan before execution/credential access. Currency-tagged integer
  micro-units, records and requests are authorized atomically across sources; each retry needs a
  fresh durable authorization. Bounds remain charged on success, cancellation and unknown outcomes,
  so this is conservative admission accounting, not a provider invoice. Per-request gates bound
  pagination; legacy currency-less source cost limits cannot authorize paid plans. PostgreSQL
  tests exercise concurrency, tenant isolation, retries and non-refund behavior. Live adapters must
  still demonstrate compliant request metering and provider-enforced bounds; measured-cost
  reconciliation and provider acceptance remain open. Owners/admins now have an owned-surface editor
  for both budgets: explicit confirmation, exact amounts, expected-version checks, locked live
  membership/session validation and atomic named audit. Other roles receive neither budget controls
  nor budget data. Migration `0017` versions acquisition edits; existing grant semantics are unchanged.
  Synthetic HTTP tests cover both role visibility and server-side enforcement. An opt-in local
  browser case additionally exercises exact amount entry, confirmation reset, two-tab conflicts
  and mobile layout. These bounded checks are not a full client/browser pilot.
  Local in-memory uploads do not
  call a provider and remain subject to the existing source/receipt checks.
- Earlier PostgreSQL evidence exercised authenticated briefing reads/reviews and the server-rendered
  Market Pulse with synthetic identities. R1A2 removes those routes from the production graph and
  replaces that evidence with explicit 404 assertions; the dormant domain remains for R2 disposition.
- Sessions now use random opaque tokens stored only as hashes, with server-enforced expiry and
  revocation, current membership/role resolution on every request and cascading invalidation when
  membership is removed. Explicit operator provisioning replaces automatic OIDC role grants.
  Production session creation/resolution use the database clock, matching locked budget authority;
  a small app/database clock skew must not make a newly issued session appear future-dated to one
  path but valid to another. Explicit test instants still exercise expiry and future-session denial.
  OIDC flow cookies have independently enforced expiry; login return paths are local-only.
  Cookie-authenticated API writes require the owned origin, and logout is a revoking POST rather
  than a prefetchable GET. Adversarial database/HTTP tests cover these boundaries. External OIDC,
  deployment-proxy configuration and the complete browser login flow remain unverified.

These are implementation gaps, additional to the external validation register. They may not be
closed merely by naming an adapter, adding a manifest or passing the existing unit suite.

### Campaign audit correction

The earlier pre-flight implementation checked field presence, evidence IDs and a plan. That was a
structural checklist, not an assessment of strategic fit. The production pre-flight path now
requires an explicit analyst-authored interpretation across strategy, audience, proposition,
distinctiveness, cultural permission, channel role and feasibility. Each finding references
current permitted evidence and applicable accepted Market Twin records. Alternatives and a
recommendation are retained; known contradictions require a visible decision rationale and remain
visible. Unresolved findings yield `needs_context`; material tensions block approval.

The owned campaign surface supports writing and inspecting this review. Snapshots bind campaign
revision, accepted measurement version, solution/sensing versions, evidence and reviewed knowledge.
Approval re-evaluates the newest assessment for every declared market/language pair against the
current locked basis, never falling back to an older ready artifact. Changing an accepted measurement plan requires a new pre-flight; plans
are frozen after approval. PostgreSQL tests cover stale plans, newer incomplete assessments and
concurrent strategy edits; HTTP coverage exercises the form surface and researcher/reviewer split.

This is a usable human-led review path, **not automated expert synthesis**. Its references establish
traceability, not that the analyst's reasoning is substantively correct; qualified review remains
necessary. Model-assisted campaign interpretation and broader browser interaction tests remain
open. Live/post context, metric reconciliation and human interpretation are described below.
General brand/strategy evidence is reusable across campaigns when applicable;
evidence explicitly scoped to another campaign cannot support this one.

### Campaign market-coverage correction

Previously a single DK/da review could authorize a campaign with no declared geographic scope.
Campaigns now declare bounded market/language pairs explicitly; the solution's markets and languages
never imply a Cartesian product. Each pair needs its own latest ready pre-flight, revalidated against
the exact campaign revision, reviewed plan, rights and Market Twin. New incomplete reviews supersede
only their own pair. Approval freezes the complete list of review IDs in the revision and audit.
Authorized connectors for other markets remain configured, but their evidence cannot enter a review
outside source policy. Missing or revoked bindings still fail closed.

The owned surface exposes per-pair coverage and a proposed-only scope editor with expected-revision
conflict protection. The measurement plan snapshots campaign scope on the server, disregarding body
claims. Scope changes invalidate earlier reviews; a mismatched plan requires replacement and review.
Legacy proposals need explicit scope and a scoped plan. Historical approvals are never backfilled.
Unit/database/HTTP tests cover pair selection, missing/incomplete/stale reviews, source permissions,
scope-edit races, foreign tenants, role denial and frozen approval lineage. An opt-in synthetic browser
case checks desktop/mobile coverage, campaign creation, scope editing and two-tab conflicts.

Explicit per-pair configurations now replace the shared metric-plan assumption. Each pair has its
own population, metric dictionary, baseline, targets, materiality, checkpoints, exposure/attribution
limitations and decision rules. The API rejects missing/duplicate/foreign pairs, unknown fields,
coerced numeric values and stale campaign/plan versions. Configuration, review and immutable
approval cover the whole plan version. Review explicitly identifies the displayed plan version;
a stale review cannot accidentally approve its replacement. Both save and review commit their
named audit atomically, and concurrent review decisions cannot both succeed.
The result form resolves the selected pair and clears previous observation/interpretation choices
on scope change. Readback uses only that configuration and rejects broad/pooled metric evidence.
The retained top-level fields are a legacy first-configuration projection, never authority to use
one market's baseline or target for another. Historical single-pair plans keep their original
meaning; shared multi-market proposals require a reviewed explicit replacement, not an inferred
migration. These changes do not establish cross-market comparability or causal lift.

Tests cover separate Danish/Swedish populations and baselines/targets, multiple metrics, persisted
live/post results, rejected cross-market observations, API role/tenant boundaries, atomic audit and
concurrent replacement. The opt-in browser cases cover per-pair editing, a two-tab stale-plan
conflict, scope-change resets and desktop/mobile layout. Synthetic proof is not research validation.

Complete multi-market learning review remains open. Live/post
readbacks reject undeclared/ambiguous pairs, and a multi-scope campaign cannot enter learning-reviewed
from a single scoped learning. Existing approved legacy campaigns without scope require a separately
reviewed migration before new scoped readbacks; no historical authorization is invented.

### Result-lineage correction

The previous live/post path trusted free-form values plus an arbitrary linked evidence ID. The
runtime now derives values from selected normalized observations. It checks the accepted frozen
plan, source permission, campaign ID, metric/unit/population/aggregation, matching source and method,
valid non-overlapping time windows and the planned baseline. Count/sum windows must have equal
duration; no implicit unit conversion, pooling or cross-provider calibration is performed. Live
results require a recent window. Target and absolute-materiality comparisons are descriptive only.

Campaign/result/plan/Market Twin fingerprints and observation lineage are saved with an atomic
audit, under the same campaign/plan/source/evidence lock order as approval. First-party aggregate
transcription is supported in the owned evidence surface and ingestion API, including suppression,
idempotency and method/scope preservation. Database and HTTP tests exercise the approved campaign
through active/completed readbacks, reject arbitrary numbers and mismatched units, and verify
copied-value removal. Current rights and expiry are checked at read time, before background cleanup.

Manual transcription is not verified extraction or an accepted live provider. Missing exact source
metadata yields a gap rather than guessed compatibility. Checkpoint/exposure alignment, calibrated
cross-source reconciliation, anomaly/fatigue interpretation, real campaign data and substantive
reviewed learning remain open. The metric join does not create a canned learning candidate.

### Interpreted learning correction

The old promotion path could turn a canned post-assessment sentence into learning, assigned a
fixed confidence and omitted market/language scope. It also read eligibility before entering the
transaction and allowed duplicate concurrent promotion. The owned campaign form now accepts an
explicit analyst interpretation with distinct observation/hypothesis/insight/recommendation,
relevance, alternative explanations, falsification conditions, declared confidence and traceable
metric/evidence/Market Twin references. Only a compatible post assessment can propose learning.

Candidate creation and review serialize per campaign, re-evaluate the latest assessment under
source/evidence/context locks, compare its frozen basis and reject stale or changed candidates.
Both operations are idempotent with atomic audits. A newer incomplete or uninterpreted assessment
cannot be bypassed through an earlier ready artifact. Generic intelligence acceptance cannot
promote a campaign decision. The accepted learning carries scope, conditions, contradictions,
dependencies and a reviewer, and expires no later than its supporting evidence/current source
licence. The candidate is superseded so it is not double-counted as accepted client knowledge.
The campaign's learning-reviewed transition also requires currently usable supporting evidence.

Database/HTTP tests cover the interpreted path through learning-reviewed, role denial, concurrent
creation/promotion, a strategy-edit race, expired support, shortened source rights and audit
cardinality. The wording guard catches a limited set of explicit causal phrases; it is not a
semantic truth detector. Qualified review of reasoning and causal language remains mandatory.
Automated model interpretation, actual pilot usefulness and full interactive browser proof remain
open. A human-authored workflow is not evidence of an autonomous expert capability.

### Company-context continuation — 2026-10-17

The owner requested stable, maintainable business context for future agent use. Reconstructing this
from each prompt or conflating it with evidenced Market Twin facts would violate portability and
traceability. The adopted slice adds a tenant-local append-only company declaration, owner/admin
review dates, optimistic concurrency and aggregate-source references. Research loads the current
declaration automatically; snapshot fingerprints and shared/exclusive locks protect both first
declaration and subsequent revision races. Campaign and production synthesis reuse the same locked
context. The transport requires explicit `client_owned` processing scope, projects only strategy
fields as untrusted data and records prompt version `research-synthesis@2`.

The D4WN content file is an owner-intent import, not a validated Market Twin or fictional pilot.
Tests cover strict parsing, research reuse, stale/foreign scope, transport projection, database
version races/authority expiry, HTTP authorization and opt-in browser import/reload/conflict behavior.
This is the company-context foundation, not proof of a connected agent, live CRM synchronization,
quality of real model output or pilot usefulness. Those release gates remain open.

## Architectural decisions

- PostgreSQL remains the system of record; canonical records receive a direct `client_id` even
  when scope could be inferred through another table.
- Existing tables are migrated additively. Legacy data is backfilled into a clearly named default
  client before tenant keys become mandatory.
- Core domain contracts and policy functions are pure TypeScript and deterministic. Drizzle query
  modules persist them; Next.js surfaces consume them but do not own business rules.
- JSONB is used for versioned payloads and method details, while fields required for isolation,
  lifecycle, lineage, filtering, and governance remain relational columns.
- Raw acquisition references are separate from retained evidence. Credentials and raw provider
  payloads never enter canonical jobs, receipts, profiles, exports, logs, or artifacts.
- Model-assisted synthesis may draft, but deterministic policy gates decide whether evidence is
  sufficient and which claim language is allowed.
- The synthesis seam is provider-neutral. Core resolves admissible evidence before a provider
  sees it and re-runs brief and causal-language policy over the proposal. The production root can
  compose an explicitly accepted client adapter; absent bindings or authority still return
  `needs_context`. Runtime configuration is not independent proof of quality or permitted processing.
- External delivery stays optional. The owned product surface is the authoritative MVP output.
- Campaign approval requires both an accepted scope-matched measurement plan and a current `ready`
  pre-flight assessment for every declared market/language pair. Completion-to-learning review
  currently supports single-pair campaigns only and requires a current accepted learning explicitly
  scoped to that campaign.
- Version allocation for solution profiles, sensing profiles, measurement plans, campaign
  revisions and campaign assessments is serialized with transaction-scoped PostgreSQL advisory
  locks; unique constraints remain the final integrity boundary.
- Adapter runs persist normalized quantitative observations and qualitative themes alongside their
  canonical evidence. Suppressed cohorts keep their lineage but never retain a usable metric value.
- Monitoring qualification compares like-for-like dimensions against the latest prior observation
  per source, persists the full qualification result, and creates only pending-review signals.
  Missing baselines and missing public-conversation risk metadata fail closed as `needs_context` or
  risk rejection; they are never translated into a no-change claim.
- The installed capability catalog now covers all ten blueprint abilities. Six use the governed
  decision-brief contract; campaign pre-flight, live intelligence, post-campaign learning, and
  Brand Lift remain versioned specialized contracts rather than being forced through a generic
  brief handler.
- The canonical scheduler enforces rights-aware evidence expiry. Expired source content, safe
  references, structured observations/themes, and copied citation excerpts are removed while a
  non-reversible lineage tombstone and tenant-scoped audit record remain. Decayed intelligence is
  no longer left live.
- External references pass through the same identifier boundary as content and become opaque when
  linkable. Decision-brief citations are validated, tied relationally to their artifact, persisted
  in the same transaction, and shown with the versioned method and uncertainty. Unreviewed
  verbatim evidence is excluded from automatic brief selection.
- Source administration persists the full policy envelope in the existing versionable JSON
  boundary: scopes, classifications, purposes, geography/language, cadence/lookback, rights,
  retention, quota and optional cost limits. Job claim and result persistence fail closed when the
  envelope is incomplete or exceeded. Revocation cancels outstanding work, marks the source
  unavailable and routes its retained material through canonical tombstoning.
- Sensing policy is portable with the solution package rather than silently remaining tenant-local.
  Version 3 imports sensing and solution versions atomically after validating local connector
  bindings; the explicit version 2 import path preserves older packages without inventing policy.

