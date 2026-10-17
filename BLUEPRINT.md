# Market Research — Product Blueprint

## 1. Document contract

| Field | Value |
|---|---|
| Product | Market Research |
| Repository | `man-D4wn/Market-research` |
| Blueprint version | 1.1.0 |
| Status | Canonical product and architecture source of truth |
| Updated | 2026-10-17 |
| Architecture family | D4WN-compatible, client-configurable intelligence product |

This blueprint defines what Market Research is, which guarantees it makes, and which boundaries
must survive changes to providers, connectors, clients, industries, and interfaces. `ROADMAP.md`
defines the implementation sequence. If an older specification, plan, implementation, fixture, or
integration conflicts with this document, this document wins until it is deliberately versioned.

## 2. Product thesis

Market Research is an evidence-driven market intelligence and campaign-learning system. It helps a
marketing leader understand what is changing, why it matters for a particular brand, what remains
uncertain, and what decision or research step should follow.

The product is not an all-knowing market oracle. Its promise is narrower and more valuable:

> Turn governed evidence from client data, commissioned research, public sources, market signals,
> and campaign results into traceable market understanding and decision-ready recommendations.

The reusable product supplies connectors, contracts, research abilities, evaluation standards,
and governance. Each client supplies a private configuration and intelligence layer describing its
brand, market, audiences, products, priorities, constraints, evidence, and learned outcomes.

The central client model is called the **Market Twin**. It is not a predictive simulation of a
market. It is a living, versioned evidence model of how the client currently understands its
market, including disagreements, uncertainty, and missing knowledge.

## 3. Product outcomes

Market Research must help an authorized user answer six recurring questions:

1. What changed in the market, audience, category, culture, or competitive situation?
2. Which change is material for this client, brand, product, or campaign?
3. What evidence supports the conclusion, and what evidence contradicts it?
4. What should the client consider doing next?
5. How should a proposed, live, or completed campaign be evaluated against that understanding?
6. What has been learned, under which conditions, and should it update the Market Twin?

The default output is a concise decision brief, not a dashboard full of unprioritized data. Deeper
evidence, methods, source coverage, confidence, and working detail remain inspectable.

## 4. Product boundaries

### 4.1 The product is

- A reusable market-research expert configured per client and industry.
- A governed synthesis of first-party, commissioned, licensed, and lawful public evidence.
- A monitoring system for meaningful changes, not a firehose of mentions.
- A campaign decision and learning system covering proposed, active, and completed work.
- A research planner that identifies evidence gaps and recommends the smallest responsible study.
- A D4WN-compatible product built from replaceable connectors and versioned abilities.

### 4.2 The product is not

- A system for identifying, tracking, scoring, or targeting individual consumers.
- A universal scraper or an entitlement to data from every social platform or forum.
- A generic social-listening dashboard, BI replacement, or unrestricted data explorer.
- A source of causal claims without an appropriate experimental or quasi-experimental design.
- A system that silently turns observations, model output, or public comments into client truth.
- A fully autonomous campaign publisher, media buyer, or customer-contact engine.
- A client-specific code fork for every implementation.

### 4.3 Explicit provider decisions

Slack and Rill are not required product dependencies. They must be removed from the active solution
profile and may not define the product's contracts, information architecture, delivery model, or
data model. If a future client selects either provider, it may return only as an optional adapter
behind a provider-neutral contract.

## 5. D4WN architectural principles

Market Research follows the same foundational rules as D4WN Core:

1. **Contract first.** Stable input, output, evidence, action, and lifecycle contracts come before
   provider-specific code.
2. **Client-owned installation.** Each client owns and runs a separate app, worker, PostgreSQL
   database, identity integration, secret store and provider accounts. `client_id` remains a
   defense-in-depth scope, not a substitute for infrastructure separation. No cross-client
   learning occurs automatically.
3. **Connectors are plumbing.** They authenticate, acquire, normalize, and deliver. They do not
   decide what matters or contain research logic.
4. **Abilities own expertise.** Research methods, decision logic, quality rubrics, and output
   standards live in versioned abilities.
5. **Core owns product truth.** Planning, relevance, evidence resolution, policy, review, learning,
   and audit remain provider-neutral Core responsibilities.
6. **Human judgment is explicit.** Material recommendations, client-truth promotion, and causal
   claims have named review gates.
7. **Learning is governed.** New knowledge enters as a candidate with provenance, applicability,
   confidence, and decay; it never becomes standing truth merely because a model produced it.
8. **Honest uncertainty.** Missing, stale, conflicting, biased, or insufficient evidence is a
   first-class product state.
9. **Replaceable surfaces.** A web application, client portal, API, document, or future delivery
   channel must consume the same redacted Core contracts.
10. **No provider lock-in.** A provider may be useful, but no provider name belongs in business
    logic or canonical intelligence schemas.

## 6. Logical architecture

```text
CLIENT SURFACES
Research workspace · decision briefs · source setup · campaign studies · exports
                              │
                              ▼
MARKET RESEARCH CORE
Intent and ability planning · evidence resolution · relevance · policy · audit
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
RESEARCH ABILITIES       MARKET TWIN       STUDY & LEARNING
Market pulse             Client truth       Baselines/targets
Competitor intelligence  Evidence graph     Experiments
Audience synthesis       Hypotheses          Readbacks
Positioning diagnosis    Contradictions      Candidate learnings
Campaign analysis        Knowledge gaps
              ▲               ▲                ▲
              └───────────────┼────────────────┘
                              │
NORMALIZED EVIDENCE AND SIGNAL CONTRACTS
                              ▲
                              │
CONNECTOR ADAPTERS
Client files · research reports · analytics · CRM/sales · surveys · public web
official statistics · news · licensed social/listening · campaign platforms
```

Connectors run inside the client's own installation or call services explicitly approved and paid
for from that client's accounts. A workflow engine or managed service may be a client-controlled
component, never a shared D4WN runtime holding multiple clients' data or credentials. These
choices must not alter contracts or move research judgment into the connector.

## 7. The Market Twin

### 7.1 Purpose

The Market Twin provides a coherent, client-specific view of the market without flattening all
inputs into one undifferentiated vector store. It connects evidence to the decisions for which that
evidence is valid.

### 7.2 Core entities

- Client, business unit, market, geography, language, and category.
- Brand, product, offer, portfolio role, value proposition, claim, and distinctive asset.
- Audience, segment, need, tension, behavior, barrier, trigger, occasion, and job-to-be-done.
- Journey stage, touchpoint, channel, retailer, distributor, and availability constraint.
- Competitor, substitute, entrant, claim, positioning, price, promotion, product move, and creative
  pattern.
- Campaign, creative route, asset, exposure, audience, channel, objective, budget assumption, and
  measurement plan.
- Signal, evidence item, research finding, hypothesis, insight, opportunity, risk, decision,
  experiment, result, and learning.
- External context including cultural, economic, technological, regulatory, seasonal, and category
  forces.

### 7.3 Intelligence states

The following states are not interchangeable:

| State | Meaning | May guide decisions? |
|---|---|---|
| Observation | A captured occurrence or metric | Only as raw evidence |
| Signal | A normalized change or pattern candidate | With source and materiality context |
| Fact | Verified statement within a declared scope and date | Yes, within applicability limits |
| Hypothesis | A falsifiable explanation requiring validation | As a hypothesis, never as fact |
| Insight | Evidence-backed interpretation relevant to a decision | Yes, with uncertainty shown |
| Recommendation | Proposed action derived from insight and client priorities | Requires the declared gate |
| Learning | Reviewed outcome tied to conditions and measurement | Yes, after promotion |

Sentiment is not behavior, conversation volume is not demand, engagement is not purchase intent,
and correlation is not causation. The system must never collapse these distinctions.

### 7.4 Record requirements

Every evidence-bearing record must include, where applicable:

- client and market scope;
- source and safe source reference;
- source type and acquisition method;
- publication, observation, ingestion, and expiry timestamps;
- rights/licensing and permitted-use status;
- methodology, universe, sample, weighting, and known limitations;
- geography, language, category, audience, and campaign applicability;
- confidence and evidence grade;
- review state: `candidate`, `live`, `quarantined`, `expired`, or `superseded`;
- contradiction and dependency references;
- an explicit distinction between source content and D4WN synthesis.

Reports such as a Dentsu audience study must preserve their segment definitions, population,
fieldwork date, method, weights, score definitions, thresholds, and limitations. Splitting a report
into text chunks is not sufficient ingestion.

### 7.5 Persistent company context

Every client has one maintained, versioned company profile: offer/operating model, target audience
and decision-makers, value proposition, intended positioning, priorities, constraints and scope.
This is owner-declared strategy, not independent market evidence. Research findings may suggest
a change, but may not silently overwrite it or promote strategic intent into an established fact.

Keep three layers distinct: company intent; dated, governed business evidence (including CRM/sales
aggregates); and reviewed market intelligence. The profile references approved sources instead of
copying sales figures or contact-level CRM records. Source binding alone grants no collection or
processing permission and is not proof of fresh data.

A future agent reads current company context for each task through a tenant-authorized Core
contract. It must not rebuild the profile from conversation memory, treat an old revision as current,
or execute commands embedded in profile text. Owner/admin changes create append-only revisions with
reason, author, timestamp and review deadline; competing edits must conflict rather than overwrite.
Research freezes the version/digest it used. A changed or overdue declared profile requires refresh
before an in-flight result can be persisted or a governed campaign decision revalidated. Historical
artifacts retain their original basis, not a claim of current validity.

The owned `/company` surface and session-scoped `company-context@1` API implement this foundation.
Agent service authentication, agent tools and live CRM/sales synchronization remain separate release
work requiring an explicit integration and data boundary. Existing clients without this new profile
retain the reviewed-Market-Twin path; the company-context endpoint honestly reports `needs_context`.

## 8. Trend-first, people-blind data boundary

### 8.1 Product rule

Market Research studies populations, themes, behaviors, and changes. It does not build intelligence
about identifiable individuals.

The target state is anonymous aggregate intelligence. Public availability alone does not make a
record anonymous, so the ingestion boundary must minimize personal data before it reaches the
Market Twin.

### 8.2 Prohibited behavior

- No consumer profile or identity graph.
- No cross-platform matching of people, handles, devices, cookies, or account identifiers.
- No longitudinal scoring or monitoring of an individual.
- No audience activation lists derived from public conversations.
- No storage of avatars, personal profile fields, or unnecessary handles.
- No inference of sensitive traits about a person.
- No use of exact public statements as model-training material for a global D4WN pack.

### 8.3 Ingestion requirements

Connector adapters must separate an ephemeral acquisition zone from retained intelligence. Before
retention, the pipeline must:

1. validate source permission and purpose;
2. remove unnecessary identifiers and provider payload fields;
3. detect sensitive or identifying content;
4. classify source, topic, market, language, and time;
5. aggregate where the research question permits it;
6. apply minimum cohort and suppression rules;
7. assign retention and deletion behavior;
8. emit only normalized evidence or a quarantined review item.

Raw source material must have bounded retention and restricted access. Retained trends must not be
reversible into people by combining stored fields.

### 8.4 Citation levels

The product uses three explicit citation levels:

| Level | Use | Default treatment |
|---|---|---|
| Statistical evidence | Aggregated counts, rates, distributions, and changes | Preferred; no person-level material |
| Paraphrased qualitative evidence | A recurring meaning or formulation | Preferred for reports and the Market Twin |
| Verbatim public excerpt | Wording itself is materially relevant | Exception; minimal excerpt, reviewed, time-bounded, source-aware |

An exact quote may be searchable and therefore identifiable even after a username is removed. It
must never be presented as anonymous by default. Product-facing citations should normally point to
the source collection, report, query, or thread context rather than creating a durable person
record. Sensitive verbatim excerpts are quarantined or excluded.

### 8.5 Additional source obligations

Privacy is only one constraint. Every source also needs explicit treatment of platform terms,
commercial-use permission, copyright/quotation rights, data freshness, geographic coverage,
sampling bias, bot/manipulation risk, and reproducibility. A configured connector is not proof that
the resulting data is representative or lawful for a particular use.

## 9. Source and connector model

### 9.1 Source classes

1. **Client-owned evidence:** brand guides, strategy, customer research, reports, presentations,
   spreadsheets, survey data, approved examples, campaign archives, and decision history.
2. **First-party behavioral and commercial evidence:** aggregate web/app analytics, search, CRM,
   sales, support, reviews, distribution, availability, price, promotion, and campaign performance.
3. **Commissioned and licensed research:** agency, panel, media, audience, brand-tracking, category,
   and syndicated datasets.
4. **Official and public evidence:** statistics, filings, legislation, official publications,
   product/price pages, competitor sites, press releases, news, search trends, and public web.
5. **Public conversation signals:** accessible and permitted social posts, comments, forums,
   communities, creator/content patterns, and review platforms.
6. **Primary research:** surveys, interviews, diaries, communities, concept tests, and experiments.

### 9.2 Connector contract

Each connector declares:

- `connector_id`, version, client scope, source class, and provider adapter;
- credential reference, never the credential value;
- permissions, data classifications, markets, languages, and permitted purposes;
- sync direction, cadence, lookback, quotas, and cost limits;
- normalization schema and evidence fields produced;
- retention, deletion, rights, and licensing rules;
- freshness, health, and last successful receipt;
- whether the connector is configured, verified, degraded, quarantined, or unavailable.

Provider payloads remain inside the adapter boundary. Core receives normalized records and redacted
receipts. A connector may be replaced without changing an ability or Market Twin schema.
Credential references must resolve only within the current client's installation; an adapter may
request only the reference assigned to its current source job. Shared/global model or connector
keys, fallback credentials and cross-client secret stores are forbidden. Deployment operators must
verify actual provider-account ownership; environment-variable names alone cannot prove it.

### 9.3 Source selection

Abilities declare which evidence they require and which source classes are acceptable. Core
resolves the smallest sufficient evidence set based on client scope, applicability, freshness,
quality, rights, confidence, contradiction, and decision relevance. Lexical or vector similarity
alone never establishes relevance.

Live research is invoked when a question depends on current, named, stale, or externally changing
facts. It supplements client intelligence; it does not silently override approved strategy or
brand law.

## 10. Research abilities

Abilities are versioned capability packages, not hardcoded controller branches. Each declares
intent, required evidence, method, outputs, uncertainty rules, quality rubric, actions, measurement
hooks, and human gates.

The target ability set is:

1. **Market and category diagnosis** — market structure, demand, growth, seasonality, drivers,
   barriers, whitespace, external forces, and knowledge gaps.
2. **Audience and purchase-behavior intelligence** — segments, needs, occasions, journeys,
   decision criteria, search/research behavior, barriers, switching, and channel behavior.
3. **Competitor intelligence** — positioning, claims, products, price/promotion, distribution,
   partnerships, media/creative behavior, customer reaction, and meaningful change.
4. **Brand positioning diagnosis** — category frame, audience tension, promise, reasons to believe,
   distinctiveness, mental/physical availability, portfolio role, and brand evolution boundaries.
5. **Cultural and trend intelligence** — emerging themes, occasions, language, creators, social
   patterns, technology, regulation, and their client-specific relevance.
6. **Campaign pre-flight** — strategic fit, audience logic, proposition, brand distinctiveness,
   cultural permission, channel role, measurement readiness, risks, and evidence gaps.
7. **Live campaign intelligence** — delivery and response changes, anomalies, creative fatigue,
   emerging reactions, competitor context, and bounded optimization hypotheses.
8. **Post-campaign learning** — results, counterfactual limits, audience/brand/commercial effects,
   conditional learnings, and follow-up research.
9. **Brand Lift study design and analysis** — objectives, hypotheses, metrics, survey instrument,
   power/feasibility, treatment/control design, analysis, uncertainty, and result interpretation.
10. **Research planning** — identify the decision-critical knowledge gap and propose the smallest
    useful desk, qualitative, quantitative, or experimental study.

## 11. Proactive monitoring

Monitoring is strategy-led, not keyword-led. Each client has a versioned sensing profile defining:

- priority markets, audiences, competitors, products, themes, occasions, and risks;
- required sources and evidence thresholds;
- cadence, lookback, freshness, expiry, and seasonality;
- materiality, confidence, novelty, and corroboration thresholds;
- down-ranking, suppression, deduplication, and quiet-period rules;
- destinations and human-review requirements;
- the decision or capability each signal may inform.

Recommended rhythms:

- urgent alerts only for high-materiality time-sensitive changes;
- daily or weekly market/competitor pulse;
- monthly positioning, audience, and campaign review;
- quarterly Market Twin health, research-gap, and strategy review.

No-change is a valid result. The product is successful when it suppresses noise as well as when it
finds something new.

## 12. Campaign lifecycle

One campaign record may move through:

`proposed → approved → active → completed → learning_reviewed → archived`

At each stage, Market Research supplies a different work product:

- **Proposed:** evidence sufficiency, strategic/brand/audience fit, assumptions, alternatives,
  measurement plan, and decision required.
- **Approved:** baseline, targets, study design, source readiness, checkpoints, and execution risks.
- **Active:** observed delivery, response, external context, deviations, hypotheses, and safe next
  decision; no causal claim from interim correlation.
- **Completed:** result readback, attribution and incrementality limits, brand and commercial
  outcomes, contradictions, and candidate learnings.
- **Learning reviewed:** accepted, rejected, or time-bound learnings with applicability conditions.

Campaign analysis must compare the work with the current Market Twin while preserving the campaign
brief and contemporary evidence used at the time. Later knowledge must not silently rewrite the
historical assessment.

## 13. Brand Lift and causal claims

The product distinguishes three measurement classes:

| Class | Typical evidence | Permitted claim |
|---|---|---|
| Brand diagnostics | Tracking surveys, search, conversation, traffic, sentiment, recall proxies | Descriptive association only |
| Directional lift | Pre/post with matched markets, interrupted time series, synthetic controls | Directional effect with limitations |
| Causal Brand Lift | Randomized treatment/control or another defensible exposure/holdout design | Incremental effect within the study scope |

A Brand Lift result requires a pre-registered measurement plan containing the outcome, population,
exposure definition, baseline, control/counterfactual, sample and power assumptions, fieldwork
window, weighting, exclusions, significance/uncertainty method, and interpretation rules.

The system may design, orchestrate, quality-check, analyze, and report a study. It must refuse to
rename ordinary campaign KPIs, social conversation, or a simple before/after change as Brand Lift.
When a causal design is unavailable, the output must use the appropriate diagnostic or directional
label.

## 14. Client configuration and portability

Each client solution consists of versioned, reviewable configuration rather than a code fork:

- enabled ability packages and versions;
- Market Twin taxonomy and canonical client strategy;
- maintained company profile with review ownership and aggregate business-source bindings;
- source connections and sensing profile;
- brand, audience, product, competitor, journey, and campaign definitions;
- metric dictionary, benchmark sources, and measurement rules;
- provider bindings and allowed data classes;
- review roles, decision rights, approval thresholds, and output destinations;
- industry pack and client-specific overrides;
- retention, rights, geography, language, and operating cadence.

The reusable artifact is the code and versioned ability/connector packages, not a shared tenant
runtime. Each copy has its own server/worker deployment, database (including jobs, audit and
backups), identity application, secret store, observability and provider projects/API keys.
Production rollout requires a one-client database check and named owner for hosting, billing,
backup/restore, key rotation and incident response. D4WN is the first such client, not the shared
operator for future customers. Moving a client between installations is an explicit export/import
and credential rebind, never a cross-database query or copied secret.

Reusable industry packs may provide a starting ontology, source suggestions, methods, and benchmark
questions. They never contain another client's data and never override client truth.

Client onboarding follows:

1. source inventory and permissions;
2. structured extraction into candidates;
3. contradiction and gap review;
4. Market Twin synthesis;
5. representative tasks and benchmark trials;
6. human calibration and activation approval.

## 15. Core contracts

### 15.1 Ability input

- task or trigger;
- `client_id` and market scope;
- resolved Market Twin context;
- normalized evidence and safe source references;
- client configuration and sensing profile;
- prior work, feedback, and campaign/study state where relevant.

### 15.2 Ability output

- structured result and human-facing executive brief;
- status: `success`, `needs_context`, `needs_human`, `blocked`, or `failed`;
- observations, hypotheses, insights, and recommendations as separately typed objects;
- evidence references, selection basis, freshness, confidence, contradictions, and limitations;
- requested research, review, measurement, or external actions;
- candidate Market Twin updates, never automatic promotion;
- method and quality report.

### 15.3 Normalized signal

A signal includes client scope, signal type, subject, observation window, values or qualitative
theme, comparison baseline, materiality, freshness, confidence, provenance, rights status,
deduplication identity, and review state. Connectors cannot submit a signal as accepted truth.

### 15.4 External actions

Modules request actions; they do not perform them. Reads and internal analysis may be autonomous.
Writes, publishing, research recruitment, survey launch, customer contact, and spend are gated.
Irreversible or high-blast-radius actions are forbidden by default.

## 16. Product experience

The primary experience is organized around the user's research and decision workflow:

1. **Ask / Projects** — direct research questions and durable workrooms.
2. **Market Pulse** — selective, source-backed changes and why they matter.
3. **Market Twin** — current client understanding, confidence, contradictions, and gaps.
4. **Campaign Studies** — proposed, live, completed, and Brand Lift work.
5. **Sources & Setup** — abilities, connectors, sensing profile, taxonomies, methods, and review
   responsibilities.

Every substantial output leads with:

- what changed or what decision is being addressed;
- D4WN's point of view;
- why it matters for this client now;
- the evidence and uncertainty;
- what would change the conclusion;
- the recommended next decision or research step.

Raw provider payloads, hidden reasoning, credentials, personal profiles, and connector internals
never appear in the product surface.

## 17. Quality and evaluation

Quality is demonstrated, not inferred from the presence of modules or fluent prose.

Required evaluation dimensions:

- evidence accuracy and citation validity;
- correct separation of observation, hypothesis, insight, recommendation, and causality;
- relevance to the client's strategy and decision;
- contradiction detection and uncertainty calibration;
- source coverage, freshness, representativeness, and rights compliance;
- alert precision, novelty, materiality, and actionability;
- market/competitor/audience diagnosis quality;
- campaign recommendation and measurement quality;
- Brand Lift statistical validity;
- protection against identity reconstruction and cross-client leakage;
- usefulness to a senior marketing or insights leader.

The benchmark suite must include representative, sparse-context, stale-data, conflicting-evidence,
manipulated-social-signal, small-sample, regulated-category, multi-market, and recovery cases.
Qualified human review remains required before claiming expert or agency-grade performance.

## 18. Minimum viable proof

The first pilot client is **D4WN** (owner decision, 2026-10-17). The pilot supports **positioning
and competitor understanding in Denmark**, aimed at CMOs and marketing managers with decision
authority. D4WN's owner describes a consultancy helping marketing departments and agencies redesign
their organization and operating model around AI, involving and training people, then building the
AI ecosystem that delivers client value. The intended position is the human and creative side of
AI transformation, not buzzwords or a prepackaged system. This is owner-provided strategic intent,
not independently established differentiation or proof of expertise. Scandinavia and Europe are
later ambitions, explicitly outside the initial pilot scope.

D4WN currently has no pilot dataset and no existing synthesis connector to reuse; this is its first
such implementation. Approved sources, provider and reviewer still need to be established. The
initial research brief and evidence gaps are recorded in `docs/external-validation-register.md`.
Synthetic fixtures prove implementation, not D4WN's market facts or quality.

The first credible proof uses one real client configuration and a bounded set of sources. The
Jacobsen-style case remains a synthetic reference because it combines brand material, a Dentsu-style
audience study, campaigns, public market evidence, and measurement needs without defining the
universal product.

The minimum proof must demonstrate:

1. ingestion of a brand guide, strategy, audience report, and campaign/result material;
2. a reviewed Market Twin with explicit gaps and contradictions;
3. a market pulse and competitor brief from permitted current sources;
4. an audience and purchase-behavior synthesis preserving research methodology;
5. a proposed campaign pre-flight assessment;
6. a completed campaign readback with honest causal limits;
7. a Brand Lift study plan that correctly distinguishes diagnostic, directional, and causal
   measurement;
8. one candidate learning reviewed and either promoted, rejected, or time-bounded;
9. evidence that retained output contains trends rather than consumer profiles;
10. provider-neutral operation with Slack and Rill absent.

## 19. Launch guardrails

- No cross-client data exposure.
- No person-level consumer intelligence or cross-platform identity matching.
- No source used outside its documented permission and rights scope.
- No verbatim excerpt represented as anonymous when it is reasonably searchable.
- No recommendation without inspectable evidence, limitations, and applicability.
- No Market Twin promotion without the declared review path.
- No causal or Brand Lift claim beyond the study design.
- No configured connector represented as healthy or evidentiary without a receipt.
- No provider-specific business logic in Core or abilities.
- No client readiness claim without real client calibration and human-reviewed benchmark evidence.

## 20. Success measures

### Decision value

- proportion of briefs that lead to a decision, research action, or explicit no-action;
- time from question or material signal to a trusted decision brief;
- user rating of relevance, clarity, novelty, and decision usefulness;
- reduction in manual synthesis time without reduced evidence quality.

### Intelligence quality

- citation correctness and source freshness;
- contradiction and research-gap detection recall;
- alert precision and duplicate/noise suppression;
- confidence calibration against later evidence;
- percentage of learnings retaining clear applicability conditions.

### Measurement quality

- campaigns with baseline, target, checkpoint, and named counterfactual limits;
- studies correctly classified as diagnostic, directional, or causal;
- Brand Lift studies passing method and power review before launch.

### Guardrails

- zero cross-client leaks;
- zero stored consumer profiles;
- zero unsupported causal claims presented as fact;
- zero unapproved promotion of candidate intelligence;
- zero provider credentials or raw provider payloads exposed in product surfaces.

## 21. Locked product decisions

1. Market Research is a D4WN-compatible, reusable client product, not a client-specific internal
   tool.
2. The Market Twin is the client-specific intelligence center; it is an evidence model, not a
   simulation claim.
3. The product is trend-first and people-blind. It does not create consumer profiles.
4. Exact public excerpts are an exception class, not the default retained evidence format.
5. Slack and Rill are removed as product dependencies; all connectors and destinations remain
   provider-neutral.
6. Social and forum coverage is source-by-source, permission-aware, and cannot be promised
   universally.
7. Brand Lift is a method class with explicit causal requirements, not a label for campaign
   correlation.
8. Client specialization belongs in configuration, the Market Twin, industry packs, and provider
   bindings rather than client-specific branches.
9. Candidate learning requires provenance, conditions, and review before promotion.
10. The roadmap must prove one bounded client case before broad connector or industry expansion.
11. Every client, including D4WN, runs on its own server/application deployment, worker,
    PostgreSQL database and provider accounts with its own keys. No shared-hosting or shared-key
    mode is a supported production configuration.

## 22. Open product decisions

- D4WN pilot's exact approved source inventory and evidence of buyer needs/differentiation;
  positioning and competitor understanding in Denmark are selected, but no real dataset or
  existing synthesis connector was available at the 2026-10-17 decision.
- The initial industry pack after the first pilot.
- Minimum cohort/suppression thresholds by source and market.
- Default raw-acquisition retention windows by source class.
- The first licensed social/listening providers and their permitted commercial uses.
- Which first-party analytics, CRM, sales, and campaign systems are required for the pilot.
- Which survey/panel or platform partners will support causal Brand Lift execution.
- The final customer-facing product name; repository name remains `Market-research`.

