# Market Research — Development Roadmap

## 1. Roadmap contract

This roadmap implements `BLUEPRINT.md` version 2.1.0. It replaces the former platform-oriented
roadmap and is the only approved delivery sequence.

The roadmap has two explicit jobs:

1. remove or park legacy and non-v1 product surface safely; and
2. build the smallest credible AI-native competitor/positioning product through a remote MCP
   contract.

Work is organized by evidence-bearing release gates, not target dates. A phase is complete only when
its exit gate passes. Code presence, a manifest, a synthetic fixture or a polished screen is not
completion evidence.

Historical plans remain available in Git history. They must not be copied into this roadmap as an
implementation journal.

## 2. Delivery rules

1. Follow the explicit dependency table. Later product work cannot bypass an unmet dependency; the
   only permitted overlap is R1A1 discovery/extraction and, after its repository worker-extraction
   evidence passes, the isolated R1A1b bounded-maintenance work while the external installation
   preflight remains open.
2. Keep legacy removal, schema destruction and new MCP functionality in separate commits and
   releases.
3. Prefer reversible disable/park steps before destructive deletion.
4. Never rewrite applied migrations; remove old schema through forward migrations.
5. Preserve the trend-first, people-blind and fail-closed boundaries throughout cleanup.
6. Define contract and evaluation failure cases before implementation.
7. Build one vertical, user-visible research path before broadening sources, tools or abilities.
8. Treat client permissions, source rights, human research quality and production operations as
   external evidence gates, never as code tasks that can self-certify.
9. Do not mix host-specific research logic into host packages.
10. Do not add a fourth source path, seventh MCP tool, second production ability or second geography
    before the minimum credible proof passes.

## 3. Target release sequence

| Phase | Outcome | Depends on |
|---|---|---|
| R0A | Scope lock, capability register and repository baseline | Blueprint v2 approved |
| R0B | Installation inventory, recovery proof and owner acceptance | R0A; may use R1A1 inventory tooling |
| R1A1 | Read-only discovery and neutral worker extraction | R0A |
| R1A1b | Additive bounded canonical maintenance | R1A1 worker-extraction evidence + approved maintenance contract |
| R1A2 | `last30days` code and packaging removal | R0B + R1A1 + R1A1b |
| R1B | Forward legacy schema cleanup | R1A2 + disposition approval + migration recovery gate |
| R2 | One active v1 capability; non-v1 product parked | R1B |
| R3 | Remote MCP foundation and read-only context tool | R2 |
| R4 | Three live source paths and competitor/positioning research | R3 |
| R5 | Complete the four-tool research and review experience | R4 |
| R6 | Second-host portability proof | R5 |
| R7 | Deployment, recovery, service and paying-pilot proof | R6 |

No additional product capability beyond the approved v1 competitor/positioning ability begins
before R7. After R7, pilot evidence selects exactly one next ability.

## 4. Cross-cutting definition of done

Every applicable work item includes:

- versioned contract and migration impact;
- normal, boundary, adversarial and failure tests;
- tenant, role, purpose and source-rights enforcement;
- bounded resource, deadline and cost behavior;
- idempotency, cancellation and retry semantics;
- redacted audit and observability;
- people-blind retained output and host projection;
- explicit deployment and rollback instructions;
- documentation and capability-register update;
- clean lint, typecheck, deterministic tests and production build;
- PostgreSQL integration tests when persistence changes;
- durable external evidence when the gate cannot be proved in code.

## 5. R0 — Scope lock and safe baseline

R0 has two gates. R0A is repository-verifiable. R0B needs installation/operator evidence. R1A1 may
run after R0A because its read-only inventory tooling helps produce R0B evidence. R1A1b may run after
the repository worker-extraction portion of R1A1 passes because it is isolated, additive hardening
and does not dispose of legacy data. R1A2 and R1B may not start while R0B is open.

### Outcome

The repository has one machine-readable capability inventory, the version 1 product decisions are
owned, and cleanup starts from a reproducible green state.

### Work

#### R0.1 Capability register

Create `product-capabilities.json` and a dependency-free CI validator. JSON is used deliberately to
avoid adding a YAML parser solely for one governance file. Each capability records:

- stable ID, purpose and non-purpose;
- owner and release state;
- contract, tool and ability versions;
- data classes and source paths;
- dependencies and human gates;
- evaluation suite and evidence references;
- supported hosts;
- operational requirements;
- deprecation and removal condition.

The validator rejects duplicate IDs, cycles, unknown versions, forbidden dependency directions and
`production_supported` without current evidence.

#### R0.2 Compatibility manifest

Create a machine-readable manifest covering:

- Blueprint version;
- Core contract version;
- database schema version;
- MCP toolset version;
- production ability versions;
- supported host-package versions;
- migration state.

#### R0.3 Decision owners

Record accountable owner roles and `requiredBefore` gates for:

- primary host and second portability host;
- D4WN competitor set and source inventory;
- licensed listening/public-conversation provider;
- research, source-rights, security and operational review;
- cohort, suppression and retention values;
- deployment region and managed-service responsibility split;
- OAuth/IdP reference flow;
- cost ceilings and pilot commercial terms;
- DPA, subprocessors, DSR/DPIA decisions;
- service objectives, RPO/RTO and support terms.

Unresolved items remain visible blockers for the phase that needs them. They do not invite speculative
implementation. Role assignment is separate from acceptance: `ownerAssignments` records the named
person's acceptance and durable evidence before R0 can close.

#### R0.4 Baseline evidence

- tag the pre-trim revision;
- run the complete repository verification;
- apply all migrations to an empty PostgreSQL test database;
- run integration and authenticated HTTP cases;
- test an upgrade from a representative pre-`0018` database with legacy rows through the existing
  immutable history to `0018`;
- take and restore a test backup;
- inventory all active routes, queues, tables and provider dependencies.

### R0A exit gate

- Blueprint and roadmap versions agree.
- Capability and compatibility manifests validate in CI.
- Decision register has accountable roles, required-before gates and explicit blockers.
- Empty-database and authenticated integration tests pass.
- The pre-trim revision is annotated, pushed and recoverable; a fresh CI checkout fetches and
  validates it against the frozen baseline commit.

### R0B exit gate

- Accountable people accept the owner roles with timestamps and durable evidence.
- Every in-scope installation is inventoried; no unknown or `not supplied` installation remains.
- Representative pre-`0018` upgrade to `0018` passes with legacy rows.
- PostgreSQL-native backup restore is timed and evidenced.

### Rollback

Documentation and manifests can be reverted without runtime change. The baseline tag and database
backup remain the recovery point for later phases.

## 6. R1 — Safe legacy removal

R1 is deliberately separate from MCP work. It is delivered as four reviewable releases.

### R1A1 — Inventory and neutral worker extraction

#### Outcome

The team can inventory legacy state without changing it, and canonical workers no longer depend on
the legacy `runQueue` module for their PgBoss lifecycle.

#### Data preflight

Inventory rows and dependencies for at least:

- `channel` and `insight_route`;
- `research_instruction` and `research_run`;
- legacy `evidence`, including `author_handle`;
- legacy `insight` and `insight_evidence`;
- related audit records, brands and markets;
- `ability_manifest`, including every stored manifest's relationship to the active and parked
  ability catalogs.

For every known installation, decide whether each class is exported, tombstoned, retained for a
bounded audit period or deleted. A missing installation is a failing discovery state, not a passing
exception or implicit waiver. Do not drop brands or markets until canonical dependencies prove they
are unused. Any identity-bearing export must be encrypted, least-privilege, access-audited,
checksum-bearing, stored in an approved location, given an expiry/destruction date and covered by
the same legal-hold and incident rules as the source database.

#### Worker extraction

- extract PgBoss connection, startup, error handling and graceful shutdown from `runQueue.ts` into a
  neutral worker-runtime module before deleting the legacy queue; today `runQueue.ts` returns the
  only PgBoss instance used by canonical acquisition, monitoring and synthesis workers;
- extract canonical retention, session cleanup and acquisition dispatch from the parked monitoring
  scheduler into a canonical maintenance scheduler;
- prove canonical acquisition, synthesis, retention, session cleanup, registration, execution and
  graceful shutdown against that neutral runtime;
- keep `research-run` fail-closed and make no legacy row changes.

#### Exit gate

- the inventory command/export is read-only, tenant-aware and checksum-bearing;
- every in-scope installation has a recorded migration head, table counts and `research-run` queue
  state; zero installations remain unknown or `not supplied` before R1A2;
- canonical queues start, execute and drain without importing the legacy run queue;
- canonical maintenance starts without enabling monitoring or briefings;
- all verification remains green.

#### Rollback

Revert the worker extraction. No schema or legacy row has changed.

### R1A1b — Bounded canonical maintenance

#### Outcome

Canonical session cleanup, retention, source revocation, acquisition reconciliation and dispatch
make bounded, resumable progress without weakening immediate source-policy enforcement or exposing
copied content while durable cleanup is pending.

#### Approved contract

- 240 seconds overall per maintenance handler invocation;
- 10 seconds per database statement and 1 second per lock wait, enforced by the database rather
  than only by a caller-side race;
- at most 500 sessions, 100 newly discovered evidence work items and 20 retention chunks per run;
- at most 100 lightweight dependant rows or 10 artifacts per applicable retention chunk;
- at most 250 collections and 250 intelligence records per run;
- at most 100 stale acquisition reconciliations and 100 dispatch attempts per run;
- at most 256 KiB (262,144 UTF-8 bytes) and 100 evidence references per serialized artifact;
- O(1) source revocation that blocks new work/use immediately and returns `cleanupPending`; and
- mandatory fail-closed artifact projection on every web and MCP DTO while durable cleanup is
  incomplete.

#### Work

- add one purpose-built durable evidence-retention continuation table and only the indexes required
  by the bounded selectors in an isolated forward migration;
- do not rewrite migrations `0001`–`0018`, modify legacy rows/schema, remove code or introduce MCP
  behavior in this release;
- process evidence dependants through idempotent phases with durable progress and `SKIP LOCKED`;
- make sessions, collections and intelligence self-advancing bounded batches with stable ordering;
- reserve time for every maintenance stage, report `batchFull`/deferred stages without an exact
  backlog count and treat expected continuation as success;
- enforce artifact byte/reference limits at the central persistence service; inventory existing
  oversize rows before validating database checks;
- make source revocation update only source state and redacted audit synchronously; exclude revoked
  sources from dispatch/use/persistence and move job, evidence and collection cleanup to bounded
  maintenance;
- add `cleanupPending` without presenting synchronous affected-row counts as complete; preserve a
  compatibility path for existing callers until they consume the new semantics;
- apply the common fail-closed redaction projection before any web or MCP artifact DTO is returned;
- retain the canonical-maintenance kill switch and document additive deployment, rollback-window,
  drain/forward-fix and installation-specific index-build controls; and
- update capability evidence without promoting canonical maintenance to production support.

#### Exit gate

- exact-limit and one-over artifact persistence tests pass;
- repeated and concurrent PostgreSQL runs drain over-limit session, evidence, dependent, artifact,
  collection, intelligence, stale-job and dispatch backlogs without cross-client work, starvation or
  unbounded counts;
- transaction-failure and restart tests prove durable idempotent continuation;
- revocation/use and revocation/completion races remain fail-closed;
- artifact output is redacted before persistent cleanup completes;
- database-enforced statement/lock timeouts and the 240-second coordinator deadline are tested;
- the real PgBoss lifecycle reports bounded backlog, resumes it on a later job and still proves
  canonical acquisition, synthesis, cleanup and graceful drain with no legacy/monitoring queue; and
- migration, rollback, capability register and operations documentation agree.

The cleanup service objective, installation sizing/index-build method, owner acceptance and all R0B
installation/recovery evidence remain open external gates. Passing R1A1b does not complete R0B or
authorize R1A2 by itself.

#### Rollback

Disable canonical maintenance, drain or explicitly preserve pending work, and revert the application
release within its documented writer-compatibility window. The additive table, nullable revocation
state and indexes may remain inert. Do not down-migrate during an incident; use a forward fix if the
rollback window has closed.

### R1A2 — Legacy code and packaging removal

#### Outcome

`last30days` and the legacy brand/instruction/run/insight workflow no longer execute, ship or appear
as an active product, while legacy database state remains operator-readable through controlled SQL
or an export artifact for the R1B decision.

#### Work

- remove `/runs`, legacy run trigger/cancel APIs and run UI;
- remove brand research-instruction surfaces that only configure `last30days`;
- remove legacy insights queue/review surfaces that do not use canonical artifacts;
- remove `runQueue`, `runLast30Days`, legacy `draftInsights`, compact-report parsing and smoke script;
- remove the direct Anthropic Messages integration embedded in `draftInsights`; it is legacy code,
  not an approved synthesis adapter;
- remove the legacy evidence purger or redirect retention exclusively through the canonical
  evidence-retention path;
- remove the legacy feature flag and legacy-only SLO/check definitions, but retain the shared
  redacted `logEvent` telemetry primitive used by canonical paths;
- stop the worker subscribing to the legacy queue;
- remove Python and the vendored engine from the runtime image;
- remove the Git submodule and `.gitmodules` requirement;
- remove submodule checkout from CI and local setup;
- mark the old subprocess ADR superseded;
- update runbooks, README and agent instructions;
- make the source-of-truth check reject new active `last30days` references.

#### Exit gate

- repository search finds `last30days` only in explicit historical records and the removal migration
  documentation;
- legacy routes return 404;
- worker starts only canonical queues;
- the full canonical lifecycle from R1A1 still passes: acquisition, synthesis, retention, session
  cleanup, registration/execution, graceful drain and restart catch-up;
- monitoring and briefings remain disabled in the final image;
- production image contains neither Python nor the vendored engine;
- CI builds the production image and records an image inspection or SBOM assertion proving the
  absence of Python and the vendored engine;
- build and all non-destructive integration tests pass;
- legacy data remains unchanged and operator-readable through controlled SQL/export pending R1B.

#### Rollback

Revert the code release. The legacy schema remains available, while ingestion stays fail-closed.

### R1B — Forward schema cleanup

#### Outcome

Identity-bearing and unused legacy storage is removed after explicit data sign-off.

#### Work

- enumerate every installation, its migration head, the `research-run` PgBoss queue state and row
  counts/client distribution for every legacy table before approving deletion;
- require zero active/retry legacy queue jobs; close or archive the queue through supported PgBoss
  administration rather than ad-hoc table deletion;
- do not auto-promote legacy evidence or insights into canonical evidence or Market Twin; material
  records must be re-onboarded through current rights, method, minimization and review contracts;
- create a forward migration from the current schema;
- remove approved legacy tables, enums, columns, indexes and foreign keys;
- remove `author_handle` and any retained provider-shaped personal fields;
- preserve only required redacted audit/tombstone history; do not bulk-copy legacy `audit_log`
  payloads into `governance_audit`;
- update Drizzle schema and queries;
- drop without `CASCADE` in dependency order so an unknown dependency fails the migration instead of
  being silently destroyed;
- test both fresh install and upgrade from the current migration head with representative rows;
- before each target installation, record the backup identifier, timestamp and checksum; prove
  restore or point-in-time recovery; set migration-specific RPO/RTO; and choose either a
  write-quiesce/read-only window or a reviewed WAL/PITR reconciliation plan;
- record that old code is compatible only with the pre-migration database, preserve a remotely
  recoverable release tag/artifact, and require an explicit owner go/no-go;
- execute a timed backup/restore and forward-fix exercise using those installation-specific
  controls.

Historical migration files remain unchanged.

#### Exit gate

- data owner approves export/retention/deletion evidence;
- fresh and upgrade migrations pass;
- canonical source, evidence, brief, context and review smoke tests pass;
- no active schema can retain a legacy identity-bearing record;
- restore/forward-fix procedure is timed and documented.

#### Rollback

There is no production down-migration. Recover through the installation-specific restore/PITR plan
or issue a reviewed forward fix. Never attach old code to the contracted database. Tag and publish
the recoverable release artifact before applying the production migration.

## 7. R2 — Activate only the v1 product

### Outcome

One bounded competitor/positioning capability is active. Deferred capabilities cannot be configured,
invoked or presented as supported.

### Active capability

Create `competitor-positioning-research@1` as the only production-target ability. Existing competitor
and brand-positioning methods may be reused internally, but the host sees one coherent product job,
not two overlapping abilities.

### Supporting capabilities

Retain only what the vertical slice needs:

- tenant, identity, role and audit boundaries;
- versioned company context;
- canonical sources, acquisition jobs, receipts and budgets;
- evidence, citations, rights, retention and minimization;
- deterministic evidence resolution;
- research artifacts and decision briefs;
- Market Twin candidate/review transitions;
- synthesis seam and spend admission;
- quality evaluations and external gates;
- operational resilience used by the active path.

### Parked capabilities

Park market/category diagnosis, broad audience research, cultural trends, general research planning,
campaign pre-flight/live/post, Brand Lift and monitoring/sensing/briefings. Remove the residual
external-delivery schema in R1B; broad industry packs remain deferred/not implemented and therefore
have no runtime capability to park.

Parking first means reversible deny-by-default controls:

- not enabled by default;
- not importable as active configuration;
- not shown as supported in navigation or APIs;
- direct calls return a stable unsupported/deferred result;
- no scheduler or external work runs for them.

After the version 1 pilot, delete parked code and schema that create material maintenance or security
cost. Git history is the archive; dormant runtime code is not.

### Administration surface

Reduce active navigation to company context, sources/rights, briefs/review and quality/operations.
`/projects` may remain an internal artifact view, but it is not the primary user experience.
Before monitoring routes are parked, move acquisition-job cancellation out of
`/api/monitoring/jobs/[id]/cancel` into a neutral application service and v1 administration route;
prove tenant, authorization, idempotency and unknown-outcome behavior there.

### Contract corrections before MCP

- model source independence explicitly; a connector ID is not a publisher/origin and cannot by
  itself establish corroboration;
- distinguish evidence lifecycle from human brief review state in contracts and UI;
- resolve the verbatim-citation validation mismatch and exclude unreviewed exact excerpts from v1;
- define every wire-status semantic and remove states no active path can produce;
- revalidate current rights, freshness and context during review, not only during drafting;
- prepare identity mapping by issuer and subject rather than subject alone;
- define a versioned successor to `quality-rubric@1` that encodes Blueprint v2 percentage thresholds,
  AI-host gates, evidence expiry and remediation; include its persistence migration, validator and
  evaluation upgrade before R4 can use it as a release gate.

### Exit gate

- only `competitor-positioning-research@1` can enter an active solution;
- parked endpoints, schedulers and imports fail closed;
- canonical acquisition cancellation remains available through the neutral route while every
  monitoring route stays fail-closed;
- active UI and documentation make no campaign, Brand Lift or monitoring product claim;
- capability register matches runtime behavior;
- existing canonical artifacts remain readable.

### Rollback

Parking controls can be reverted. A parked capability may return only through a new reviewed
capability version and release gate, never a hidden feature flag.

## 8. R3 — MCP foundation and read-only context

### Outcome

The primary host can install Market Research and safely read current D4WN company/market context
through one canonical remote MCP tool.

### Work

#### R3.1 Application boundary

- introduce application services and redacted DTOs between persistence and all surfaces;
- prohibit MCP and web handlers from importing query modules directly;
- codify dependency boundaries in lint/CI;
- version request/response envelopes and error states.

#### R3.2 Remote MCP transport

- implement Streamable HTTP MCP at a versioned endpoint;
- publish tool metadata and schemas;
- implement only `get_market_context` initially;
- provide health, protocol and bounded resource handling;
- keep optional host UI out until the tool-only flow is proven.

#### R3.3 Agent identity

- implement service/delegated OAuth separately from browser-cookie authentication;
- bind token to installation tenant, host/client identity, subject, role, purpose and scope;
- support revocation and expiry;
- audit host, subject, tenant, role, purpose, contract version and result status;
- reject tenant selectors supplied in tool arguments.

#### R3.4 Security and compatibility

- golden request/response fixtures;
- prior-minor compatibility rules;
- size, nesting, timeout and rate limits;
- malicious company/source text tests;
- cross-tenant, expired, revoked and over-scoped token cases;
- field-level host exposure snapshot.

### Exit gate

- a real installation in the selected primary host reads current D4WN context;
- no browser session is used as an agent credential;
- invalid scope and membership fail closed;
- only redacted DTO fields reach the host;
- application dependency checks and MCP contract tests pass.

### Rollback

Disable MCP ingress and revoke the host client. Core and the admin/review surface continue without a
schema rollback.

## 9. R4 — Live sources and competitor/positioning research

### Outcome

The primary host can request the first real, governed D4WN competitor/positioning brief.

### R4.1 Source approval before adapter code

Approve the D4WN source inventory, purpose, rights, retention, geography, cost and reviewer before
registering a production adapter.

Deliver source paths sequentially:

1. approved client documents;
2. trusted public/official web;
3. one licensed listening or public-conversation provider.

Each path must pass live connection/receipt, normalized provenance, minimization, failure/degradation,
quota/cost, retention/expiry, revocation/deletion and human contribution-to-brief checks before work
begins on the next path.

“Trusted web” receives an operational policy: primary/official preference, authority tiers,
freshness, allowed retrieval, conflict handling, safe references and reproducibility.

### R4.2 Synthesis provider

Register exactly one reference synthesis provider after processing, retention, quality, budget and
failure acceptance. Core selects evidence before provider access and revalidates claims and current
authority before persistence. Provider output cannot grant citations, rights or review status.

### R4.3 Research tool

Implement `research_competitor_positioning` and the read-only `get_research_brief` for the server-pinned
`competitor-positioning-research@1` ability. The host cannot supply an ability ID, source/evidence IDs
or a completed analysis. The tool is asynchronous and returns a bounded state such as `queued`,
`success`, `needs_context`, `blocked` or `failed`, plus a durable research reference.

`get_research_brief` is the only host polling/resume path for queued work. It returns bounded
queued/running/final state and, when final, the exact versioned brief with evidence, limitations and
research gaps. R4 briefs remain `needs_human`; they are not decision-ready until the R5 review tool
accepts the displayed version.

Persist invocations independently of the MCP session with a unique tenant/subject/tool/idempotency
key, input digest, state, artifact reference and timestamps. Host timeouts and retries must not create
duplicate external work or briefs.

The tool must freeze company context, source policy, selected evidence, ability, model and contract
versions. Insufficient coverage returns `needs_context`.

### Exit gate

- all three source paths produce current live receipts;
- every material brief claim has traceable, permitted evidence;
- release evaluation meets the Blueprint's initial thresholds;
- the versioned Blueprint-v2 rubric and AI-host gates, not the transitional rubric alone, produce
  the release decision;
- named reviewers record remediation and retest;
- p50/p95 latency, maximum brief cost and acceptable abstention range are recorded;
- source/model kill switches and budget revocation stop new work immediately.

### Rollback

Disable the research tool or individual adapter, revoke its budget/credentials and retain historical
artifacts with their frozen basis and changed availability state.

## 10. R5 — Complete research and review experience

### Outcome

An authorized user completes question → brief → evidence/gaps → named review inside the AI host,
while administrators use only the narrow supporting surface.

### Toolset completion

Add the final write tool:

- `review_research_brief`, which accepts, rejects or requests revision of the exact displayed brief
  version.

Together with the R3 `get_market_context` and R4 research/read tools, this completes the initial
four-tool set. Source health remains in the administration surface. A fifth or sixth tool requires a
named pilot case, failing evaluation and Blueprint-compliant change record.

### Review and artifact rules

- material recommendations return `needs_human` until reviewed;
- `review_research_brief` is explicitly write/review-gated;
- retries are idempotent and conflicting decisions serialize;
- review revalidates current role, source rights, evidence, company context and artifact basis;
- audits and state transitions commit atomically;
- write-tool availability can be disabled independently of read access;
- brief/context projections reveal necessary coverage/freshness/rights state, never credentials or
  provider payloads.

### Exit gate

- the end-to-end primary-host flow passes with real D4WN evidence;
- viewer, researcher, reviewer and administrator boundaries hold;
- no host instruction can bypass Core review or policy;
- every tool passes normal, edge, adversarial and out-of-scope conformance tests;
- the secondary web surface contains only necessary administration and review.

### Rollback

Disable `review_research_brief` independently while preserving read-only research history. Roll back
a tool contract only within the declared compatibility window.

## 11. R6 — Second-host portability proof

### Outcome

The same canonical service works in a second AI host without research-logic forks.

### Work

- package and install a thin adapter for the selected second host;
- map its OAuth/admin lifecycle to the same authorization contract;
- run the shared golden and adversarial MCP suite;
- compare tool selection, error handling, confirmations and field exposure;
- document host-specific network, policy, UI and installation differences;
- prohibit prompt forks that change method, rights, review or evidence logic.

### Exit gate

- identical canonical inputs produce contract-equivalent artifacts in both hosts;
- authorization and revocation behave consistently;
- field-level exposure snapshots contain no unexplained difference;
- limitations are published and support ownership is named;
- portability is claimed only for these conformance-tested hosts.

### Rollback

Remove or disable the second host package. No Core, evidence or database migration is required.

## 12. R7 — Production service and paying pilot proof

### Outcome

Market Research can be bought, operated, recovered, upgraded and offboarded as a premium service.

### R7.1 Managed single-tenant reference

- reproducible deployment and environment validation;
- regional database, encryption and secret storage;
- least-privilege source/model accounts;
- content-safe logs, metrics and alerts;
- tested key rotation and access revocation;
- backup schedule, timed restore and RPO/RTO evidence;
- upgrade, compatibility, forward-fix and rollback process;
- cost caps and per-installation usage visibility.

### R7.2 Customer-operated enterprise option

Document the required infrastructure, ownership matrix, signed artifacts, upgrade window, support
boundary, diagnostic bundle, security notifications and acceptance checklist. Do not represent this
mode as supported until a clean external deployment passes.

### R7.3 Legal, support and offboarding

- DPA, subprocessors, residency and privacy roles;
- source-rights and policy owners;
- incident severity, contacts and response commitments;
- export format and completeness checks;
- credential revocation and data destruction evidence;
- commercial inclusion/exclusion of provider usage;
- customer modification and support policy.

### R7.4 Paying pilot

Run multiple real D4WN competitor/positioning cases, including adversarial and sparse-context cases.
Record user/reviewer outcomes, decision value, time saved, cost, latency, abstention and remediation.
Do not broaden scope to compensate for a quality problem.

### Exit gate

- clean managed deployment passes;
- timed restore, incident and release rollback exercises pass;
- all source, rights, research-quality, security and operations gates have named current evidence;
- no P0/P1 isolation, evidence-integrity or review defects remain;
- primary and second host remain conformant;
- pilot users rate the product at the declared quality threshold;
- commercial terms and willingness to pay are evidenced;
- every remaining limitation is explicit.

## 13. Post-v1 selection gate

After R7, choose exactly one next capability from measured pilot demand:

- audience synthesis;
- proactive monitoring;
- campaign learning; or
- research/study planning.

The chosen capability receives a separate job-to-be-done, source and tool impact, method, quality
thresholds and paid pilot. Existing code creates no priority entitlement.

Brand Lift, full campaign lifecycle, real-time alerts, broad industry packs and marketplace work
remain deferred until a separate business and evidence gate justifies them.

## 14. Required test matrix

Every relevant phase covers:

- cross-client, cross-role and cross-purpose access;
- revoked, expired and concurrently changed identity or policy;
- missing, stale, conflicting, dependent, low-quality and biased evidence;
- personal identifiers, searchable excerpts and combined-field re-identification;
- malicious source instructions, redirects and cross-tool exfiltration;
- duplicate, bot-like, coordinated and manipulated conversation signals;
- source revocation, deletion, quota, cost and partial failure;
- provider replacement behind the same Core contract;
- host tool confusion and competing installed tools;
- unsupported claim states and overconfident language;
- client configuration without code branches;
- audit, retention, expiry, supersession and rollback;
- crash recovery, unknown external outcome and replay;
- fresh installation and supported-version upgrade.

## 15. External evidence gates

These cannot be closed by repository code alone:

- client-approved pilot scope, competitors and sources;
- source permission, licence, purpose and quotation rights;
- live connector/provider acceptance;
- retention, cohort and suppression approval;
- qualified research, rights, security and operations reviewers;
- human scorecards on real briefs;
- host administrator acceptance and conformance evidence;
- production deployment, backup, restore and incident exercises;
- commercial terms and willingness to pay.

The application and capability register expose these as `needs_context`, `blocked`, expired or
verified with owner, scope, date and durable reference.

## 16. Commit, release and push policy

Use one reviewable commit and green gate per boundary:

1. Blueprint, roadmap and baseline manifests;
2. bounded canonical maintenance additive migration and runtime;
3. legacy code/runtime detachment;
4. legacy schema cleanup migration;
5. v1 activation and capability parking;
6. MCP application/auth/context contract;
7. live sources and competitor/positioning research;
8. complete review toolset;
9. second-host portability;
10. service operations and pilot proof.

Never combine legacy destruction with MCP functionality in the same commit or release. Never push a
known-red build or a half-applied destructive migration. Tag the verified pre-trim baseline, the
schema-cleanup release and every production release.

## 17. Immediate next actions

1. Approve Blueprint v2 and this roadmap.
2. Commit the canonical documentation reset.
3. Complete R0A; then run R1A1 discovery/extraction and, after its repository worker-extraction
   evidence passes, R1A1b bounded-maintenance hardening while closing R0B. Do not start R1A2 until
   R0B, R1A1 and R1A1b pass.
4. Name primary/secondary hosts and decision owners.
5. Produce the legacy data inventory and pre-trim recovery evidence.
