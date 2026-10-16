# Market Research — Build Roadmap

## 1. Roadmap contract

This roadmap implements `BLUEPRINT.md` version 1.0.0. It replaces the legacy Audience Insights
Engine implementation plan. Work is organized by evidence-bearing release gates rather than target
dates. A phase is complete only when its exit gate passes; code presence or a polished screen is
not sufficient.

The roadmap deliberately proves one bounded client case before broadening connectors, industries,
or automation. The existing application is useful scaffolding, but its Slack/Rill delivery model,
legacy schema, and internal-tool assumptions are not the target architecture.

## 2. Delivery principles

1. Build vertical slices that end in a verifiable research work product.
2. Define and test contracts before adding provider adapters.
3. Keep migrations additive until the replacement path is proven; remove legacy tables and code in
   a separate, reviewable cleanup step.
4. Never fake a live source, delivery receipt, study result, or causal conclusion.
5. Preserve source methodology, rights, provenance, and uncertainty through every transformation.
6. Test the people-blind boundary at ingestion and at every product-facing projection.
7. Use client configuration and ability packages instead of client-specific conditionals.
8. Treat human benchmark evidence as a release artifact.

### 2.1 Execution correction

The phase outcomes below remain canonical, but they are implemented as vertical slices rather than
independent horizontal layers. Tenancy, security, retention, audit, idempotency, observability,
failure handling, and owned-surface proof are part of every applicable phase and may not be deferred
to Phase 8. The rationale and baseline gap analysis are recorded in
`docs/roadmap-evaluation.md`.

Repository-verifiable completion is distinct from external validation. Live source permissions,
pilot data, qualified method review, human scorecards, and production restore exercises require
named evidence; until supplied, the product must report `unverified` or `needs_context` rather than
claiming those gates passed.

## 3. Baseline at roadmap approval

The repository currently contains:

- a Next.js/React application;
- PostgreSQL and Drizzle migrations;
- a `pg-boss` background-worker foundation;
- authentication, roles, audit helpers, and health checks;
- brand, market, research-run, evidence, and insight concepts;
- a pinned `last30days` research submodule and worker boundary;
- legacy provider-specific delivery and ingestion code;
- legacy client-specific product documents and operational procedures.

This baseline should be reused where it conforms to the blueprint. It is not proof that the new
product model, privacy boundary, research methods, or client portability exist.

## 4. Release sequence

| Phase | Outcome | Depends on |
|---|---|---|
| 0 | Product reset and legacy isolation | Blueprint approved |
| 1 | Canonical contracts and data foundation | Phase 0 |
| 2 | People-blind evidence ingestion | Phase 1 |
| 3 | Market Twin onboarding and resolution | Phase 2 |
| 4 | Core research abilities and decision briefs | Phase 3 |
| 5 | Campaign lifecycle and analysis | Phase 4 |
| 6 | Measurement and Brand Lift | Phase 5 |
| 7 | Proactive monitoring and learning loop | Phases 3–6 |
| 8 | Client packaging, hardening, and pilot proof | Phases 0–7 |

### 4.1 Execution status — 2026-10-16

The deterministic reference path is covered end to end by
`src/workflows/reference-pilot.test.ts`. That proof is intentionally not presented as live pilot
evidence.

| Phase | Repository implementation | Open release evidence |
| --- | --- | --- |
| 0 | Complete and shipped | None |
| 1 | Canonical contracts, additive migration, direct client scope, membership and transition tests implemented | Apply and verify migration in the selected environment |
| 2 | Adapter registry, durable dispatcher/executor, bounded retry, cancellation, stale-job reconciliation, minimization, quarantine, identifier-safe source references, rights-aware expiry, scheduled canonical tombstoning, artifact-linked citation records, normalized quantitative observations/qualitative themes and four deterministic source classes implemented; source policy, scope, rights, lookback, quota and cost limits are runtime-enforced; revocation cancels active work and tombstones retained content; unregistered and legacy ingestion fail closed | Approved sources, registered live adapters and provider acceptance |
| 3 | Persistent text/CSV/JSON upload and permitted-link onboarding, method preservation, idempotency, contradictions and relevance resolution implemented | Pilot documents, qualified lineage review and any required office/PDF extraction adapter |
| 4 | All ten blueprint abilities have versioned installable manifests; six research/planning abilities produce persistent governed decision briefs with an inspectable evidence/method drawer while campaign pre-flight/live/post and Brand Lift use their specialized contracts; durable tenant-scoped Ask / Projects workrooms bind decision context and artifacts; provider-neutral synthesis is gated by deterministic evidence selection before drafting and claim validation afterwards; applicability-aware evidence selection, Market Twin review, causal guards and fail-closed human scorecard rubrics are implemented | An approved synthesis provider plus qualified reviewers must record provider acceptance and representative/adversarial scores |
| 5 | Persistent campaign revisions and evidence, ready pre-flight approval gate, versioned live/post assessments, and reviewer-promoted campaign learning implemented in the owned surface | One real campaign with aggregate result sources through the full lifecycle |
| 6 | Persistent measurement plans and studies with separate reviewer decisions, strengthened metric/date/sample validation, deterministic classification and reproducible binary-lift analysis implemented | Qualified method review and an approved live study |
| 7 | Versioned sensing administration includes audiences, occasions, risks, decision contexts, lookback, novelty, seasonality, deduplication, suppression/down-ranking, expiry and mandatory owned-surface review; tenant-scoped durable cadence scheduling, acquisition dispatch, cancellation and reconciliation, historical-baseline qualification, auditable qualification receipts, fail-closed `needs_context`, no-change/source-health outcomes, pending-review signals, briefing contracts, governed learning promotion and monitoring scorecards are implemented | Registered live connectors, real baselines, approved risk metadata and shadow-mode evidence |
| 8 | Five-role runtime authorization, source/sensing/solution administration, atomic tenant-neutral checksum-verified solution+sensing v3 import/export with a v2 migration path, second-client proof, concurrency locks, durable quality/remediation evidence, expiry-aware validation gates, automated evidence/collection/intelligence retention enforcement, resilience controls and operations runbook implemented | Named pilot inputs, clean deployment, restore evidence and operating owners |

Anything in the final column remains `needs_context`; it is not silently converted into completion.

## Phase 0 — Product reset and legacy isolation

**Status: complete (2026-10-16).** Evidence: `docs/phase-0-legacy-inventory.md`,
`src/connectors/contracts.ts`, connector contract tests, and the CI-enforced
`check:source-of-truth` command. Legacy database structures remain only under the additive-migration
exception documented in the inventory.

### Outcome

The repository has one product definition, no active Slack/Rill requirement, and an explicit map
from reusable current code to legacy code scheduled for retirement.

### Work

- Make `BLUEPRINT.md` and `ROADMAP.md` the canonical documents.
- Mark `product-spec.md` and `implementation-plan.md` as superseded compatibility pointers.
- Update `README.md` and `AGENTS.md` to reference the new source of truth.
- Inventory every Slack- and Rill-specific file, environment variable, database field, workflow,
  screen, test, runbook step, and dependency.
- Classify each item as:
  - remove now;
  - retain temporarily for migration;
  - generalize behind a provider-neutral contract;
  - historical record only.
- Supersede the Rill-specific ADR without rewriting history.
- Define the replacement seams:
  - `EvidenceSourceAdapter` for inbound evidence;
  - `MetricSourceAdapter` for aggregate metrics;
  - `DeliveryAdapter` for optional outbound artifacts;
  - `SourceAcquisitionJob` and redacted receipt contracts.
- Remove Slack/Rill from active navigation, default configuration, health/readiness claims, and
  acceptance criteria.
- Add a source-of-truth check that prevents legacy specifications from being treated as current.

### Exit gate

- No canonical documentation names Slack or Rill as a requirement.
- The application can build and run with all Slack/Rill environment variables absent.
- A reviewed deletion/generalization manifest covers every Slack/Rill reference.
- Existing tests remain green or are deliberately replaced by equivalent provider-neutral tests.

## Phase 1 — Canonical contracts and data foundation

### Outcome

The system can represent clients, sources, evidence, the Market Twin, abilities, studies, campaigns,
and governed learning without provider-specific fields or person-level consumer records.

### Workstream 1A: tenancy and configuration

- Introduce `client` and client-partitioned storage boundaries.
- Define a versioned client solution profile containing enabled abilities, provider bindings,
  markets, languages, sensing rules, review roles, and retention policies.
- Add authorization tests proving that one client cannot read or mutate another client's records.
- Keep credentials outside application records; store opaque `credential_ref` values only.

### Workstream 1B: canonical evidence

- Define schemas for:
  - source connection;
  - source-acquisition job and receipt;
  - evidence item and evidence collection;
  - normalized quantitative observation;
  - normalized qualitative theme;
  - signal and contradiction;
  - citation and citation level;
  - method, sample, weighting, rights, freshness, and applicability.
- Separate raw acquisition references from retained evidence.
- Implement candidate/live/quarantined/expired/superseded lifecycle states.

### Workstream 1C: Market Twin

- Implement the entity and relationship schema from the blueprint.
- Represent observation, fact, hypothesis, insight, recommendation, decision, and learning as
  separate types.
- Add explicit contradiction, uncertainty, evidence-gap, and supersession relationships.
- Add client and global scope separation; block automatic client-to-global promotion.

### Workstream 1D: abilities and outputs

- Define versioned ability manifests, evidence selectors, method declarations, quality rubrics,
  output schemas, and human gates.
- Define one product-facing decision-brief contract with progressive detail.
- Define candidate-learning and promotion contracts.

### Exit gate

- JSON/schema validation covers every canonical contract.
- Tenant-isolation tests fail closed.
- The schema can represent the complete first-pilot fixture without Slack, Rill, or client-specific
  code.
- A deterministic test proves that a signal cannot enter the Market Twin as a fact or learning
  without the required transition.

## Phase 2 — People-blind evidence ingestion

### Outcome

The product can acquire permitted source material, transform it into useful retained trends and
evidence, and prove that it does not create consumer profiles.

### Workstream 2A: adapter SDK

- Build the provider-neutral source adapter interface.
- Support activation checks, bounded acquisition, pagination/cursor handling, retry, cancellation,
  quotas, costs, and redacted receipts.
- Ensure raw provider payloads and credentials never cross the adapter boundary.
- Add connector health states that distinguish configured, verified, degraded, unavailable, and
  producing evidence.

### Workstream 2B: minimization and transformation

- Create the ephemeral acquisition zone and configurable raw retention.
- Strip handles, avatars, profile IDs, user URLs, device IDs, and unnecessary timestamps before
  retained storage.
- Add identifying/sensitive-content detection and quarantine.
- Add aggregation, cohort thresholds, suppression, language detection, topic classification,
  deduplication, and bot/manipulation indicators.
- Store the method used to produce every aggregate or qualitative theme.

### Workstream 2C: citation policy

- Implement statistical, paraphrased, and verbatim citation levels.
- Default product output to statistical or paraphrased evidence.
- Require a review reason, retention rule, and safe reference for verbatim public excerpts.
- Test that exact searchable quotes cannot be mislabeled as anonymous.

### Workstream 2D: first source adapters

Build only the source classes required by the first pilot:

- uploaded/client-mounted documents and common office formats;
- public and official web sources;
- official statistics or search-trend inputs;
- one permitted forum/social/listening adapter;
- one aggregate first-party metric adapter if pilot data is available.

The existing `last30days` integration may be retained only if its source access and output can meet
the new adapter, rights, minimization, and provenance contracts without patching vendored code.

### Exit gate

- Red-team fixtures containing names, handles, profile URLs, sensitive statements, and linkable
  combinations do not enter retained trend storage.
- Every retained item has source, rights, method, freshness, confidence, and client scope.
- Raw acquisition can be expired without breaking retained aggregate evidence.
- At least three source classes produce normalized evidence through the same Core contract.

## Phase 3 — Market Twin onboarding and resolution

### Outcome

A client can turn its strategy, brand, audience research, market material, and campaign history into
a reviewed Market Twin that is useful, inspectable, and honest about gaps.

### Workstream 3A: source-first onboarding

- Add client source inventory and upload/link workflows.
- Extract candidate entities, relationships, facts, hypotheses, constraints, and methods.
- Preserve tables, survey methodology, segment definitions, weights, dates, and limitations from
  reports rather than treating them as plain text.
- Provide contradiction and duplicate review before promotion.

### Workstream 3B: canonical client views

- Build canonical client strategy, brand, audience, market, competitor, purchase-journey, campaign,
  measurement, and ways-of-working views.
- Add an explicit knowledge-gap register and research backlog.
- Add Market Twin version history and source lineage.

### Workstream 3C: relevance resolution

- Resolve evidence using decision requirements, client scope, applicability, source grade,
  freshness, rights, confidence, contradiction, and diversity.
- Preserve decision-critical requirements even when semantic similarity is low.
- Emit a redacted selection basis showing why evidence was used or excluded.

### Reference pilot fixture

Use a Jacobsen-style fixture containing:

- a brand guide and strategy;
- a Dentsu-style audience study with method and segment weights;
- product/value proposition material;
- competitor definitions;
- proposed and completed campaign material;
- aggregate result data;
- current public market evidence.

The fixture validates the generic model; no Jacobsen-specific code or taxonomy is allowed.

### Exit gate

- A qualified reviewer can trace every canonical Market Twin statement to evidence or an explicit
  synthesis record.
- Contradictory source claims remain visible and cannot be resolved by ingestion order.
- A Dentsu-style report retains its method, population, weights, thresholds, and applicability.
- Re-running onboarding is idempotent and does not silently overwrite reviewed intelligence.

## Phase 4 — Core research abilities and decision briefs

### Outcome

The system performs useful market research, not merely retrieval or summarization.

### Ability 4A: market and category diagnosis

- Market structure, demand, growth, seasonality, macro/regulatory/technology forces.
- Price, promotion, distribution, availability, category entry points, and whitespace.
- Explicit research questions and evidence gaps.

### Ability 4B: audience and purchase behavior

- Segments, needs, tensions, occasions, jobs, barriers, triggers, journey, switching, and channel
  behavior.
- Clear separation of stated attitudes, observed behavior, and modeled inference.

### Ability 4C: competitor intelligence

- Competitor and substitute set, positioning, claims, products, pricing, distribution, creative
  patterns, partnerships, public response, and material changes.
- Source-backed comparison rather than a generic SWOT template.

### Ability 4D: brand positioning diagnosis

- Category frame, tension, promise, reasons to believe, differentiation, distinctive assets,
  mental/physical availability, portfolio role, and evolution choices.
- Current brand law remains distinct from proposed evolution.

### Product output

- Implement the decision brief: change/question, point of view, client relevance, evidence,
  contradictions, uncertainty, recommendation, research gap, and next decision.
- Provide an evidence drawer and method appendix without making them the primary answer.

### Exit gate

- All four abilities pass structural contract tests.
- Human reviewers score representative and adversarial cases for accuracy, relevance, evidence,
  strategic value, and executive usability.
- Unsupported evidence produces `needs_context`, not plausible filler.
- The output correctly distinguishes attitudes, behavior, demand, and causality.

## Phase 5 — Campaign lifecycle and analysis

### Outcome

One campaign can be assessed before launch, monitored while active, and reviewed after completion
against the Market Twin and the evidence available at each point in time.

### Workstream 5A: campaign record and lifecycle

- Add persistent proposed/approved/active/completed/learning-reviewed/archived states.
- Preserve brief, objectives, audience, proposition, routes, assets, channels, budget assumptions,
  measurement plan, approvals, and revision history.
- Link campaign evidence by time and scope without rewriting historical assessments.

### Workstream 5B: pre-flight ability

- Evaluate strategic fit, audience logic, proposition, brand distinctiveness, cultural permission,
  channel roles, execution feasibility, evidence sufficiency, risks, and measurement readiness.
- Return one clear point of view, watchouts, required decisions, and research gaps.

### Workstream 5C: live campaign ability

- Compare actual delivery and response with baseline and checkpoints.
- Detect anomalies, fatigue, emerging reactions, contextual changes, and competitor interference.
- Frame optimization ideas as hypotheses until appropriate evidence exists.

### Workstream 5D: post-campaign ability

- Join approved plan, execution evidence, result sources, data-quality checks, and external context.
- Separate observed results, attribution assumptions, causal limits, alternative explanations, and
  candidate learning.

### Exit gate

- One pilot campaign completes the lifecycle without losing versioned evidence.
- Pre-flight output cannot pass without a credible measurement plan or explicit remediation.
- Live monitoring never presents interim correlation as causal learning.
- Post-campaign learning remains conditional and requires review before Market Twin promotion.

## Phase 6 — Measurement and Brand Lift

### Outcome

The product can design and evaluate defensible campaign studies while refusing unsupported causal
claims.

### Workstream 6A: measurement-plan contract

- Objective, hypothesis, population, metric definitions, baseline, target, checkpoint, exposure,
  source, attribution, incrementality, materiality, and decision thresholds.
- Metric dictionary prevents incompatible measures from being compared silently.

### Workstream 6B: study classifier

- Deterministically classify proposed methods as diagnostic, directional, or causal.
- Explain missing requirements and the strongest claim the design can support.
- Block the term `Brand Lift` for designs that cannot support it.

### Workstream 6C: Brand Lift planner

- Survey outcomes and instrument quality.
- Treatment/control or approved alternative design.
- Sample, power/feasibility, fieldwork window, weighting, exclusions, uncertainty, and stopping
  rules.
- Provider-neutral handoff to a platform, panel, survey, or analytics adapter.

### Workstream 6D: analysis and reporting

- Validate study integrity before analysis.
- Report effect, uncertainty, base rates, subgroup cautions, multiplicity where relevant, and
  practical significance.
- Preserve pre-registration and distinguish planned from exploratory analysis.

### Exit gate

- A test suite rejects naive before/after and social-sentiment analyses as causal Brand Lift.
- A valid holdout fixture produces reproducible results with uncertainty and interpretation.
- A low-power or contaminated study returns inconclusive rather than inventing lift.
- A qualified research reviewer signs off the method and output language.

## Phase 7 — Proactive monitoring and learning loop

### Outcome

Market Research becomes a selective ongoing expert rather than a manual report generator.

### Workstream 7A: sensing profile and scheduler

- Configure themes, markets, competitors, products, sources, cadences, materiality, confidence,
  freshness, deduplication, suppression, and quiet periods.
- Emit provider-neutral acquisition and analysis jobs.
- Keep no-change outcomes and source-health failures visible.

### Workstream 7B: signal qualification

- Compare with historical baseline, known seasonality, source bias, and current Market Twin.
- Require corroboration appropriate to the signal class.
- Detect duplicate, manipulated, bot-heavy, low-sample, and stale signals.

### Workstream 7C: briefings

- Urgent material alert.
- Weekly market/competitor pulse.
- Monthly audience/positioning/campaign review.
- Quarterly Market Twin health and research-gap review.
- Deliver first in the owned product surface; external destinations remain optional adapters.

### Workstream 7D: governed learning

- Convert reviewed campaign/study outcomes into candidate learnings.
- Preserve conditions, evidence, causal limitations, contradictions, confidence, and decay.
- Require accept, reject, revise, or time-bound review decisions.

### Exit gate

- Shadow-mode evaluation covers a meaningful volume of real pilot signals.
- Human reviewers score relevance, novelty, timeliness, trust, and actionability.
- Duplicate/noise and dismissal rates meet agreed thresholds.
- No proactive run silently promotes learning or performs an external action.

## Phase 8 — Client packaging, hardening, and pilot proof

### Outcome

The reusable product can be configured for another client without a code fork and handed off with
evidence of quality, security, recoverability, and operating responsibility.

### Workstream 8A: solution packaging

- Version Core, ability packages, schemas, industry packs, client profiles, and adapter interfaces.
- Support pinned versions and explicit migrations.
- Provide import/export of redacted client configuration without credentials or client content.
- Document the supported managed, client-owned, and hybrid deployment modes.

### Workstream 8B: administration

- Source connections, Market Twin onboarding, abilities, sensing profile, methods, roles, retention,
  and provider bindings.
- Keep provider credentials and raw payloads outside the admin surface.
- Show configuration, verification, and evidence-producing states distinctly.

### Workstream 8C: operational hardening

- Durable worker execution, idempotency, bounded retry, circuit breakers, cancellation, and
  reconciliation.
- Backup/restore exercise, migrations, observability, alerts, cost controls, rate/quotas, incident
  runbooks, and rollback.
- Security, cross-client isolation, prompt/source injection, artifact access, and leakage testing.

### Workstream 8D: client pilot

- Run representative direct research, proactive monitoring, campaign, and study cases.
- Record qualified human scorecards, remediation, retests, and client calibration evidence.
- Measure decision usefulness, time saved, citation quality, and alert precision.

### Exit gate

- A second client fixture can be configured without modifying Core business logic.
- Clean-environment verification and restore tests pass.
- No P0/P1 security, tenancy, evidence-integrity, or causal-claim defects remain.
- The pilot scorecard passes agreed thresholds and every remaining limitation is explicit.

## 5. MVP scope

The MVP is the smallest vertical proof spanning Phases 0–6 for one client. It includes:

- files/reports, public web/official sources, one public-conversation source, and one aggregate
  result source;
- Market Twin onboarding for strategy, brand, audience, market, competitors, purchase journey,
  campaigns, and measurement;
- market pulse, competitor brief, audience synthesis, and brand-positioning diagnosis;
- proposed-campaign pre-flight and completed-campaign readback;
- Brand Lift study planning with method classification;
- evidence citations, contradictions, uncertainty, and candidate-learning review;
- owned product-surface delivery only.

The MVP does not include every social platform, real-time monitoring, autonomous publishing,
cross-client benchmarks derived from client data, person-level analysis, or an automatic causal
Brand Lift claim.

## 6. Initial backlog order

### Now

1. Write canonical schemas for client, source, evidence, citations, Market Twin, abilities,
   campaigns, studies, and learning.
2. Design additive migrations from the current schema.
3. Build the people-blind ingestion/redaction test harness.
4. Select the first pilot and confirm its source inventory and permissions.

### Next

5. Implement file/report and public-web adapters.
6. Implement Market Twin onboarding and contradiction review.
7. Implement the decision brief and first four research abilities.
8. Add campaign pre-flight and post-campaign readback.
9. Add measurement-plan and Brand Lift classification.

### Later

10. Add licensed social/listening providers source by source.
11. Add live campaign monitoring and proactive schedules.
12. Add survey/panel and platform study adapters.
13. Add industry packs after the first pilot establishes the reusable boundary.
14. Prove second-client portability and production handoff.

## 7. Cross-cutting test matrix

Every relevant phase must cover:

- cross-client access attempts;
- missing, stale, conflicting, low-quality, and biased evidence;
- personal identifiers and searchable verbatim excerpts;
- sensitive statements and child-related content;
- duplicate, bot-like, coordinated, and manipulated public signals;
- source revocation, deletion, quota, and partial failure;
- provider replacement behind the same contract;
- unsupported causal claims and low-powered studies;
- client-specific configuration without code branches;
- audit, retention, expiry, supersession, and learning rollback.

## 8. Definition of done

A roadmap item is done only when:

- its contract and behavior are implemented;
- automated tests cover normal, boundary, and failure paths;
- tenant, source-rights, retention, and people-blind rules are enforced;
- the product-facing state is honest and actionable;
- evidence and audit records are complete but redacted;
- relevant documentation and migration notes are updated;
- the clean verification gate passes;
- any human-method or quality gate has named evidence rather than an assumed pass.

## 9. Decisions required before implementation passes Phase 2

- Name the first pilot client or approved representative dataset.
- Confirm the exact pilot sources and the permitted use for each.
- Set initial cohort/suppression and raw-retention defaults.
- Decide whether the current `last30days` adapter can meet the people-blind evidence contract.
- Select the first aggregate performance source.
- Name the qualified reviewers for market research and Brand Lift methodology.

These are external validation gates. Their absence does not block implementation with deterministic,
non-production fixtures, but it does block live-source activation, a production-ready claim, and
final completion of the affected phase exit gates.

