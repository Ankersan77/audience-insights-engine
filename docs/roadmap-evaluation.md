# Roadmap evaluation and execution corrections

Date: 2026-10-16  
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

- first pilot client or approved representative dataset;
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
  classifications fail closed. Production synthesis still returns no provider: a provider
  interface and fixture tests alone do not satisfy the expert-research requirement.
- Weekly/monthly/quarterly review packets now have opt-in solution configuration, closed UTC
  windows, bounded restart catch-up, durable idempotent artifacts, tenant-scoped owned-surface
  delivery and atomic accept/reject audit. Missing coverage is not no-change, and unavailable
  evidence prevents acceptance. The packets deliberately index existing evidence and work; they
  do not yet provide expert narrative synthesis. Urgent alert delivery, late-evidence revision
  workflows and live shadow-mode quality proof remain open.
- Queued acquisition now requires an explicit operator-enabled, client-wide daily budget and a
  synchronous adapter upper-bound plan before execution/credential access. Currency-tagged integer
  micro-units, records and requests are authorized atomically across sources; each retry needs a
  fresh durable authorization. Bounds remain charged on success, cancellation and unknown outcomes,
  so this is conservative admission accounting, not a provider invoice. Per-request gates bound
  pagination; legacy currency-less source cost limits cannot authorize paid plans. PostgreSQL
  tests exercise concurrency, tenant isolation, retries and non-refund behavior. Live adapters must
  still demonstrate compliant request metering and provider-enforced bounds; operator-budget UI,
  measured-cost reconciliation and provider acceptance remain open. Local in-memory uploads do not
  call a provider and remain subject to the existing source/receipt checks.
- The PostgreSQL suite now exercises actual authenticated HTTP briefing reads/reviews and the
  server-rendered Market Pulse with real server sessions for synthetic identities. This does not exercise external
  OIDC login or interactive browser flows; broader product and browser verification remains open.
- Sessions now use random opaque tokens stored only as hashes, with server-enforced expiry and
  revocation, current membership/role resolution on every request and cascading invalidation when
  membership is removed. Explicit operator provisioning replaces automatic OIDC role grants.
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
Approval re-evaluates the newest assessment against the current locked basis, never falling back to
an older ready artifact. Changing an accepted measurement plan requires a new pre-flight; plans
are frozen after approval. PostgreSQL tests cover stale plans, newer incomplete assessments and
concurrent strategy edits; HTTP coverage exercises the form surface and researcher/reviewer split.

This is a usable human-led review path, **not automated expert synthesis**. Its references establish
traceability, not that the analyst's reasoning is substantively correct; qualified review remains
necessary. Model-assisted campaign interpretation, live/post-campaign Market Twin context,
source-backed metric reconciliation, multi-market approval coverage and broader browser interaction
tests remain open. General brand/strategy evidence is reusable across campaigns when applicable;
evidence explicitly scoped to another campaign cannot support this one.

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
- The synthesis seam is provider-neutral. Core resolves the admissible evidence before a provider
  sees it and re-runs the full brief and causal-language policy over the proposed analysis. Until
  a provider and its processing boundary have acceptance evidence, production synthesis is absent
  and requests fail honestly as `needs_context`.
- External delivery stays optional. The owned product surface is the authoritative MVP output.
- Campaign approval requires both an accepted measurement plan and a saved `ready` pre-flight
  assessment. Completion-to-learning review requires an accepted learning explicitly scoped to
  that campaign.
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

