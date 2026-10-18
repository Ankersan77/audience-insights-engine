# Market Research — Product Blueprint

## 1. Document contract

| Field | Value |
|---|---|
| Product | Market Research |
| Repository | `man-D4wn/Market-research` |
| Blueprint version | 2.1.0 |
| Status | Canonical product, architecture, governance and release contract |
| Updated | 2026-10-18 |
| Architecture family | AI-native, client-isolated evidence intelligence service |

This blueprint defines what Market Research is, what a client installs, which guarantees the product
makes, and which boundaries must survive changes to AI hosts, models, sources, providers, clients,
industries and interfaces. `ROADMAP.md` defines the only approved delivery sequence.

If code, an older plan, a fixture, an integration or an architecture decision conflicts with this
document, this document wins until deliberately versioned. Historical migrations and decisions remain
interpretable history; they are not active product requirements.

## 2. Product contract

### 2.1 Product thesis

Market Research is a governed market-intelligence capability used directly from a company's chosen
AI environment. It turns approved client material, trusted web evidence and permitted market signals
into source-backed, decision-ready research without turning public conversation into consumer
profiles or weak correlations into facts.

The product's first promise is deliberately narrow:

> Give a marketing decision-maker a critical, source-backed competitor and positioning brief inside
> the AI tool they already use, showing what is known, contradicted, uncertain and worth validating
> next.

The product is not an all-knowing market oracle. Its premium value is traceability, decision
relevance, disciplined uncertainty and safe reuse of company context—not the number of generated
pages or connected platforms.

### 2.2 Buyer, users and decision rights

- **Buyer:** a marketing, insights, strategy or transformation leader responsible for research
  quality and adoption.
- **Primary user:** an authorized strategist, marketer, researcher or agency employee working in
  ChatGPT, Claude, Copilot or another supported MCP host.
- **Administrator:** configures identity, sources, rights, budgets and host availability.
- **Reviewer:** accepts, rejects or requests revision of material recommendations and Market Twin
  candidates.
- **Operator:** owns deployment, recovery, upgrades and incidents; this may be D4WN or the client,
  depending on the selected deployment mode.

Authentication never grants a role by itself. Tenant membership and product permissions are explicit,
revocable and checked on every request.

### 2.3 First job-to-be-done

For the first pilot, an authorized D4WN user must be able to ask how D4WN should position itself for
Danish CMOs and marketing managers, compare observable competitor and substitute claims, inspect the
supporting evidence and gaps, and obtain a responsible next research or positioning decision.

The first output is a competitor/positioning decision brief. It is not a general social-listening
dashboard, campaign-effect report or proof of buyer demand.

## 3. Product form and packaging

### 3.1 Primary experience

The primary experience is the client's existing AI host. Market Research is installed there as a
versioned plugin, connector or equivalent package backed by a remote Model Context Protocol (MCP)
server.

The web application is a secondary, narrow administration and review surface. It may manage company
context, sources, rights, quality evidence, review queues and operational status. It must not become a
second general research workspace that duplicates the AI host.

### 3.2 Reusable product artifacts

The sellable product consists of:

1. a versioned host package containing minimal instructions and connection metadata;
2. a canonical remote MCP gateway with stable, typed tools;
3. provider-neutral Market Research Core contracts and policies;
4. a client-isolated data plane containing jobs, evidence, Market Twin state and audit;
5. approved source and synthesis adapters bound to client-owned accounts or explicitly accepted
   managed accounts;
6. a private client configuration containing company context, source policy, roles, markets and
   enabled abilities;
7. evaluation, deployment, upgrade, recovery and offboarding evidence.

Host packages contain no client facts, provider credentials or duplicated research logic. Business
logic remains in Core so the same governed result can be reproduced across supported AI hosts.

### 3.3 Host portability promise

The product promises one canonical MCP tool contract with thin, tested host packages. It does not
promise identical host features or installation mechanics.

Each supported host receives a compatibility record covering transport, authentication, tool and UI
support, administrator installation, network/data-policy constraints, conformance evidence, known
limitations and minimum supported version. A host is not called supported until its conformance tests
pass. Host-specific extensions may improve presentation but may not change product truth,
permissions, evidence selection or review semantics.

## 4. Scope discipline

### 4.1 Version 1 includes

- installation in one primary AI host and portability proof in one second host;
- remote MCP with the bounded toolset in section 7;
- versioned company context;
- three source paths: approved client documents, trusted public/official web sources, and one
  permitted licensed listening or public-conversation provider;
- competitor and positioning research for Denmark;
- one evidence-backed decision-brief contract;
- evidence selection, contradiction handling, research gaps and honest abstention;
- reviewer-gated material recommendations and Market Twin candidates;
- a narrow source, rights, review, quality and operations administration surface;
- one managed single-tenant reference deployment and a documented customer-operated option;
- live source receipts, human evaluations and recovery evidence before a production claim.

### 4.2 Version 1 does not include

- a generic social-listening dashboard or unrestricted data explorer;
- every social, forum, news or analytics provider;
- full campaign lifecycle management or live campaign optimization;
- Brand Lift execution or analysis;
- general survey, panel or primary-research orchestration;
- real-time alerts or autonomous monitoring actions;
- autonomous publishing, media buying, recruitment, customer contact or spend;
- a graph database, universal ontology, generic workflow engine or vector database without measured
  evidence that the bounded product requires one;
- cross-client learning from client content;
- client-specific code forks.

Campaign learning, Brand Lift, broader audience intelligence, proactive monitoring and industry
packs are deferred capabilities. Existing code for them may be parked or removed; its presence does
not make the capability part of the supported product.

### 4.3 Overbuild budget

Version 1 starts with four MCP tools and is limited to six, one production ability, three production
source paths, one primary geography, one primary output contract, one reference synthesis adapter
and one reference identity flow behind a provider-neutral boundary. No new platform capability is
accepted before the first human-reviewed live pilot brief.

A proposed addition must identify the pilot case that needs it, the evaluation that can fail, the
existing contract it reuses, its owner, operating cost and removal condition. Otherwise it is
deferred.

## 5. Product invariants

1. **Contract first.** Stable tool, input, output, evidence, review and lifecycle contracts precede
   provider code and host packages.
2. **AI host is a surface, not authority.** The host may orchestrate conversation; Core decides
   authorization, evidence eligibility, claim state, review state and durable product truth.
3. **Client isolation.** Client content, credentials, jobs, evidence and audit are isolated by data
   plane. `client_id` remains defense in depth, never a substitute for isolation.
4. **Connectors are plumbing.** They authenticate, acquire and normalize. They do not decide what
   matters or create accepted insight.
5. **Abilities own research methods.** A production ability has a versioned method, source
   requirements, claim taxonomy, failure modes, evaluations and human gates.
6. **Human judgment is explicit.** Material recommendations and client-truth promotion have named
   review paths.
7. **Learning is governed.** Model output never becomes standing client truth merely because it was
   generated fluently.
8. **Honest uncertainty.** Missing, stale, conflicting, biased or insufficient evidence is a valid
   `needs_context` result.
9. **Provider names stay outside Core.** Reference adapters are explicit; canonical business schemas
   and policies remain provider-neutral.
10. **Historical reproducibility.** Durable outputs freeze the versions and evidence basis used.
11. **No silent activation.** A migration, import, deployment or model upgrade never enables a
   source, budget, ability or write action.
12. **No feature by code presence.** A capability is supported only at the release state defined in
   section 16.

## 6. Logical architecture

```text
CHATGPT · CLAUDE · COPILOT · OTHER SUPPORTED MCP HOST
                         │
             thin host package + OAuth
                         │
                         ▼
                 REMOTE MCP GATEWAY
       bounded tools · schemas · authorization · audit context
                         │
                         ▼
                MARKET RESEARCH CORE
 intent/ability planning · evidence resolution · methods · policy
 claim validation · review transitions · reproducible artifacts
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   COMPANY CONTEXT   MARKET TWIN   RESEARCH ARTIFACTS
   declared intent   accepted       briefs · gaps
                     intelligence   review candidates
          ▲              ▲              ▲
          └──────────────┼──────────────┘
                         │
           NORMALIZED EVIDENCE CONTRACTS
                         ▲
                         │
                  SOURCE ADAPTERS
 client documents · trusted web · licensed listening/public signals

SECONDARY ADMIN/REVIEW SURFACE
identity · sources · rights · company context · review · quality · operations
```

The conversational host never queries the database or provider directly. MCP handlers call
application services, which apply the same policy and authorization as every other surface. Source
adapters and synthesis providers never receive more client context than the approved request needs.

## 7. Canonical MCP contract

### 7.1 Initial toolset

The initial version 1 toolset contains four tools:

| Tool | Purpose | Default action class |
|---|---|---|
| `research_competitor_positioning` | Start or resume the one server-pinned production research ability | Read/compute |
| `get_research_brief` | Retrieve task status or a governed brief with its safe evidence drawer and gaps | Read-only |
| `get_market_context` | Read current approved company context and applicable Market Twin records | Read-only |
| `review_research_brief` | Accept, reject or request revision of a material brief | Write/review-gated |

Research gaps remain part of context and brief output; source health remains in the administration
surface. A separate gap, source-status or Market Twin-review tool may be added only for a named pilot
need and may not raise the total above six. Generic CRUD tools and direct database/query tools are
prohibited. Administrative source setup, credential management and destructive operations do not
belong in the version 1 conversational toolset.

The host cannot supply an `abilityId`, evidence IDs, source IDs or a completed analysis. Core pins the
production ability and owns source selection.

### 7.2 Common request envelope

Each request resolves authenticated subject and client scope, host and package version, purpose,
market/language, project context, contract version, idempotency where needed, resource bounds, role
and review authority. The client cannot select another tenant through a request field. Human-readable
text is untrusted data, not executable instructions.

### 7.3 Common response envelope

Every tool returns:

- status: `success`, `needs_context`, `needs_human`, `blocked` or `failed`;
- a concise human-facing result or progress state;
- typed claims when research is returned;
- safe evidence references, selection basis, freshness and method;
- contradictions, uncertainty and limitations;
- the next permitted decision or research step;
- artifact and contract versions;
- a redacted correlation ID.

Tool output never contains credentials, raw provider payloads, hidden reasoning, unnecessary personal
data or unrestricted internal records. Errors are bounded and redacted.

### 7.4 Host conformance

Before a host package is released, normal, edge, adversarial and out-of-scope prompts verify correct
tool selection, tenant/role/review enforcement, no reliance on host memory as current company truth,
correct abstention, resistance to injected source content, equivalent canonical artifacts and safe
fallback when an optional host capability is missing.

## 8. Deployment and identity

### 8.1 Supported deployment modes

**Managed single-tenant is the version 1 default.** D4WN operates an isolated data plane per client
under a documented DPA, support model and regional deployment choice. Client data and credentials are
not pooled, and no automatic cross-client learning occurs.

**Customer-operated single-tenant is the enterprise option.** The same versioned artifacts run in the
client's approved environment. The client or its operator owns infrastructure, while D4WN supplies
documented requirements, signed releases, upgrade/migration guidance and compatibility support.

A shared multitenant data plane is not supported. A central distribution/control service may publish
signed versions and non-content health metadata, but it may not hold client evidence, credentials or
research artifacts.

### 8.2 Installation ownership

“Installed in the client's AI toolkit” means the client's administrator approves and enables the
host package/MCP connection for authorized users. It does not by itself determine who operates the
isolated backend.

Every production installation has named owners for AI-host administration, identity/access, data
plane/database, secrets/provider accounts, source rights/data policy, backup/restore/incidents,
research review and billing/usage limits.

### 8.3 Authentication and authorization

Remote MCP uses standards-based OAuth 2.0/OIDC appropriate to the selected host. The canonical
authorization layer supports delegated user identity and narrowly scoped workload identities. Shared
credentials are allowed only when explicitly selected, least-privileged and visible as a shared
access boundary.

Browser session cookies are never reused as agent credentials. Each tool call checks current tenant
membership, role, purpose and data scope. Removal of membership or source permission takes effect on
the next request and blocks in-flight persistence where applicable.

## 9. Company context and Market Twin

### 9.1 Three distinct knowledge layers

1. **Company intent:** owner-declared offer, audience, value proposition, intended positioning,
   priorities and constraints.
2. **Governed business evidence:** dated aggregate CRM, sales, analytics, research and campaign data.
3. **Reviewed market intelligence:** accepted evidence-backed facts, insights, hypotheses and gaps.

Company intent is not independent evidence. Research may challenge it but cannot silently overwrite
it or promote it into a market fact.

### 9.2 Market Twin purpose

The Market Twin is a versioned evidence model of the client's current accepted market understanding.
It is not a predictive simulation, a consumer graph or an undifferentiated vector store.

Version 1 uses only the record kinds needed by the first ability: accepted market or competitor fact,
accepted audience/positioning insight, hypothesis, knowledge gap and a material signal when supported
by the selected source path. New record kinds require a production ability and an evaluation that
needs them.

### 9.3 Intelligence states

| State | Meaning | Permitted use |
|---|---|---|
| Observation | Captured occurrence or metric | Raw evidence only |
| Signal | Normalized change/pattern candidate | With materiality and source context |
| Fact | Verified statement within declared scope/date | Decisions within applicability |
| Hypothesis | Falsifiable explanation requiring validation | Clearly labelled exploration |
| Insight | Evidence-backed interpretation for a decision | Decisions with uncertainty shown |
| Recommendation | Proposed action derived from insight and company priorities | Named review gate |
| Learning | Reviewed outcome tied to conditions and measurement | Deferred from v1 production scope |

Sentiment is not behavior, conversation volume is not demand, engagement is not purchase intent and
correlation is not causation.

### 9.4 Versioning

Owner/admin changes to company intent are append-only and include reason, author, time and review
deadline. Research freezes the revision and digest used. Changed, invalid or overdue context blocks a
new canonical result until refreshed. Historical artifacts retain their original basis without
claiming current validity.

## 10. Evidence and source model

### 10.1 Version 1 source paths

1. **Approved client documents:** strategy, brand material, commissioned research and other files the
   client has authority to process.
2. **Trusted public/official web:** an allowlisted or policy-resolved set of official publications,
   statistics, filings, legislation, competitor sites, product pages and reputable current sources.
3. **Licensed listening/public conversation:** one named provider whose commercial use, retention,
   quotation and aggregation conditions are approved.

Source availability is never implied by public accessibility. A connector is not healthy or
evidentiary until a current receipt proves it produced permitted data.

### 10.2 Connector contract

Each connector declares connector/adapter version, client scope, source class, opaque credential
reference, permissions, classifications, purpose, markets/languages, cadence/lookback, resource and
currency limits, output schema, retention/deletion/rights, freshness and verified health.

Provider payloads remain inside the ephemeral adapter boundary. Core receives normalized evidence
and redacted receipts. Credentials, raw payloads and fallback/global keys never enter jobs, logs,
exports, profiles, artifacts or host output.

### 10.3 Evidence record

Every retained evidence item includes, where applicable:

- client, market, language and subject scope;
- source class, connector version and safe source reference;
- acquisition method and publication/observation/ingestion/expiry timestamps;
- policy version, rights basis, purpose and restrictions;
- methodology, universe, sample, weighting and limitations;
- applicability to market, audience, category, competitor and research task;
- explainable quality dimensions;
- lifecycle/review state, contradictions and dependencies;
- explicit separation of source content and system synthesis.

Version 1 explains quality through source authority, directness, recency, methodological fit,
independence and applicability. A combined confidence score may be shown only after calibration.
Multiple publications derived from one origin do not count as independent corroboration.

### 10.4 Evidence selection

Core selects the smallest sufficient, diverse evidence set using the ability method, applicability,
freshness, quality, rights, contradiction and decision relevance. Lexical or vector similarity alone
never establishes relevance.

Current facts require live research. Live evidence supplements company intent; it cannot silently
override it. Missing coverage produces a research gap, not plausible filler.

## 11. Trend-first, people-blind boundary

### 11.1 Product rule

Market Research studies populations, themes, behaviors and changes. It does not identify, track,
score or target individual consumers.

Prohibited behavior includes consumer profiles, identity graphs, cross-platform matching,
longitudinal individual monitoring, public-conversation activation lists, unnecessary handles or
profile fields, sensitive-trait inference and durable exact public statements as training material
for a reusable pack.

### 11.2 Ingestion boundary

Before retention, every adapter must validate permission/policy/purpose, minimize identifiers,
detect identifying/sensitive/instruction-like content, classify scope, aggregate where permitted,
apply approved cohort/suppression rules, assign retention and emit normalized evidence or quarantine.

Raw acquisition is encrypted, access-restricted, excluded from ordinary logs and backups unless
explicitly required, and deleted on a bounded schedule. Crash leftovers and temporary files follow
the same policy. Retained aggregates are tested for re-identification risk through combined fields.

### 11.3 Citation levels

| Level | Default treatment |
|---|---|
| Statistical evidence | Preferred; no person-level material |
| Paraphrased qualitative evidence | Preferred for briefs and Market Twin |
| Verbatim public excerpt | Exceptional, minimal, reviewed, time-bounded and source-aware |

An exact quote may be searchable and identifiable even without a username. It is never described as
anonymous by default. Sensitive excerpts are quarantined or excluded.

## 12. Security, privacy and rights

### 12.1 Trust boundaries

The release dataflow identifies the AI host, MCP gateway, Core, synthesis provider, data plane,
source adapters, observability and operator access as separate trust boundaries. A field-level data
inventory states what crosses each boundary, for which purpose, for how long and under whose
authority.

### 12.2 Prompt and tool security

Source, company and tool text is untrusted data. The product requires instruction/data separation,
provenance tagging, bounded input/output/nesting/redirects/deadlines, acquisition egress policy,
least-privilege tool annotations, confirmation for material writes, source quarantine, an operational
kill switch, cross-tool exfiltration evaluations and redacted errors/logs/telemetry. Pattern matching
is defense in depth, never proof of complete prompt-injection protection.

### 12.3 Rights and privacy governance

Every production source has a versioned policy decision recording owner, purpose, legal or
contractual basis, commercial-use and quotation rights, geography, retention, deletion path,
approver, review date and expiry. The result is `allow`, `allow_with_controls`, `quarantine` or
`deny`; deny is the default for missing, expired or conflicting policy.

Before a paying pilot, client and operator record controller/processor roles, DPA, subprocessors,
data residency, DSR/deletion SLA, incident path and any DPIA requirement. Changed source rights can
block new use and trigger governed expiry of retained material.

## 13. Research ability and output contract

### 13.1 Production ability

Version 1 has one production ability: `competitor-positioning-research`.

It frames the decision and comparison set; distinguishes competitor self-description from
independent evidence; compares observable audience, promise, offer, proof, delivery model and
positioning claims; surfaces contradictions and unknowns; tests positioning options against company
intent and market evidence; states trade-offs and counter-evidence; recommends the smallest useful
validation step; and abstains when evidence cannot support a material conclusion.

An ability is production-supported only when it has a versioned method, claim taxonomy, source
requirements, failure modes, adversarial evaluations, named reviewer and live pilot evidence.

### 13.2 Decision brief

The canonical `decision-brief@2` contains decision/scope, point of view, current client relevance,
typed material claims, citations, source-selection basis, method, contradictions, alternative
explanations, uncertainty, falsification/change conditions, recommendation/review requirement,
research gaps, next decision, frozen context/evidence/contract versions and freshness status.

The host may summarize the brief conversationally, but only the canonical artifact is durable and
reviewable. Host wording may not upgrade claim type or remove limitations.

## 14. Quality contract

Quality is demonstrated by versioned evaluation evidence, not inferred from code, module names or
fluent prose.

### 14.1 Initial release thresholds

The pilot uses these initial targets, calibrated and deliberately versioned before general
availability:

- at least 98% correct and resolvable citations;
- 100% evidence lineage for material claims;
- zero accepted consumer profiles, cross-client leaks, rights-denied evidence or unapproved
  promotions;
- at least 95% correct claim-state classification;
- at least 95% recall on planted material contradictions;
- no more than 1% unsupported material claims;
- median qualified-reviewer score of at least 4/5 for relevance, clarity and usefulness;
- documented response-time and total-cost ceilings per brief;
- an explicit calibrated abstention rate and review of false confidence.

Synthetic fixtures validate structure and policy but cannot satisfy live-source, research-quality or
production-readiness gates.

### 14.2 Evaluation suite

The suite includes representative, sparse-context, stale-data, conflicting-evidence, malicious-
source, manipulated-social-signal, small-sample, multi-language, permission-revocation, host-tool-
confusion and recovery cases.

Each supported host runs the same canonical cases plus host-specific conformance cases. Human scores
record reviewer, method, artifact version, limitations, remediation and retest. Expired evidence
reopens the gate.

## 15. Operations and commercial service boundary

Before a paying pilot, each installation defines service owner and incident model; availability and
freshness objectives; RPO/RTO and timed restore; signed release, patch, migration and rollback;
compatible version window; spend owner and quotas; privacy/security/source-rights contacts;
offboarding, credential revocation and destruction evidence; content-free telemetry; and the
responsibility split between D4WN, client and providers.

Commercial packaging states implementation fee, subscription/support fee, usage/provider costs,
included hosts and sources, customer modification rights and the support consequence of unapproved
changes. Client content and credentials are never reused as a hidden product-improvement subsidy.

### 15.1 Canonical maintenance resource contract

Canonical maintenance is a bounded, resumable operation rather than an installation-sized
transaction. One handler invocation has a 240-second wall-clock budget. Database statements have a
10-second statement timeout and a 1-second lock timeout; a caller-side timeout alone is not
sufficient. Each stage must preserve enough of the overall budget for later stages or defer cleanly.
Expected backlog is successful continuation, not a job failure, and must be reported without an
unbounded exact count.

The approved per-invocation maxima are:

| Operation | Maximum |
|---|---:|
| Expired or revoked sessions | 500 rows |
| Newly discovered evidence-retention work | 100 evidence rows |
| Evidence-retention work | 20 chunks |
| Lightweight dependants in one retention chunk | 100 rows |
| Artifacts in one artifact-retention chunk | 10 rows |
| Expired evidence collections | 250 rows |
| Decayed intelligence records | 250 rows |
| Stale acquisition reconciliations | 100 jobs |
| Acquisition dispatch attempts | 100 jobs |

One serialized artifact payload is limited to 256 KiB (262,144 UTF-8 bytes) and 100 evidence
references. Limits are enforced at the central persistence boundary, not merely by UI or host
instructions. Existing oversize records must be inventoried before database constraints are
validated.

Source revocation is an O(1) control-plane transition: it records the revoked source state and its
redacted audit event immediately, blocks new dispatch, evidence use and result persistence
immediately, and returns `cleanupPending` while bounded durable cleanup proceeds. It must not scan or
mutate every dependent row synchronously or promise exact immediate affected-row counts. Completion
and dispatch recheck current source state.

Every web or MCP artifact projection fails closed while cleanup is pending. Before returning copied
artifact content, the application intersects its evidence basis with current expired or revoked
evidence, applies the common redaction projection, and marks the basis stale or expired. This
read-time protection is mandatory and does not replace persistent cleanup.

The durable continuation marker, revocation state and supporting indexes are introduced only in an
isolated additive forward migration under Roadmap R1A1b. The migration cannot remove or rewrite
legacy schema, activate a source or ability, or add MCP functionality. The cleanup service objective
and installation-specific index-build method remain owner/evidence decisions; this contract does
not close R0B or authorize R1A2.

## 16. Capability and change governance

### 16.1 Release states

Every capability has one evidence-backed state:

`designed → implemented → externally_validated → production_supported → deprecated → removed`

Only `production_supported` capabilities may be sold without an explicit pilot limitation. Code
presence or a passing unit test is insufficient.

### 16.2 Capability register

One machine-readable register records purpose/non-purpose, owner, state, contract/ability versions,
sources/data classes, review gates, dependencies, evaluation evidence, supported hosts, operational
requirements and deprecation/removal condition. CI rejects duplicate identifiers, unknown versions,
prohibited dependency directions and production status without current evidence.

### 16.3 Dependency rules

- Core does not import provider, host or UI modules.
- MCP and web handlers call application services, never database queries directly.
- Source adapters cannot create accepted insight, recommendation or learning.
- Synthesis providers cannot authorize access, rights, spend or review transitions.
- UI and MCP expose only redacted application DTOs.
- Migrations cannot activate sources, abilities, budgets or write actions.
- Client specialization belongs in configuration and evidence, not Core branches.

### 16.4 Change contract

A material capability change includes problem evidence, alternatives, dataflow impact, contract
change, evaluations, migration/deprecation impact, operational cost and rollback. Contract versions
follow semantic compatibility rules; incompatible changes require a migration path and host
compatibility update.

## 17. Legacy and deletion policy

`last30days`, the identity-bearing legacy evidence path, research-run UI/queue and related provider-
shaped schema are not part of the target product. R1A2 removed the executable code and packaging;
R1B removed the separately approved obsolete schema through its recovery and forward-migration
gates. The definitions remain only in immutable historical migrations and evidence.

Historical migrations are not rewritten. A forward cleanup migration removes obsolete runtime
structures after the data decision and rollback plan are reviewed. Historical ADRs may remain marked
superseded; they may not impose active dependencies, Docker contents, setup steps, CI checkout
requirements or agent instructions.

Campaign, Brand Lift and monitoring code that does not serve version 1 is treated separately from
legacy: it may be parked behind unsupported status or removed when carrying it creates security,
schema, UI or maintenance cost. No deferred capability may appear enabled or production-ready.

## 18. Success measures

### Customer value

- briefs leading to a decision, research action or explicit no-action;
- qualified user score for relevance, clarity, novelty and usefulness;
- time from question to trusted brief;
- reduced manual synthesis time without reduced evidence quality;
- repeat use by the intended role in the client's chosen AI host.

### Product quality

- citation validity and material-claim lineage;
- contradiction/gap detection and confidence calibration;
- source coverage, freshness, independence and rights compliance;
- correct abstention and review-gate behavior;
- equivalent canonical results across supported hosts;
- cost and latency within the declared service envelope.

### Guardrails

- zero cross-client leaks or retained consumer profiles;
- zero unsupported causal claims presented as fact;
- zero unapproved Market Twin promotions;
- zero credentials or raw provider payloads in surfaces, logs or exports;
- zero source use after permission or policy expiry.

## 19. Minimum credible proof

The first credible proof is complete only when:

1. D4WN company intent is reviewed and current;
2. the Danish competitor/positioning source inventory and rights are approved;
3. all three version 1 source paths produce live normalized evidence and receipts;
4. the production ability returns a traceable `decision-brief@2` or honest `needs_context`;
5. a qualified reviewer scores representative and adversarial live briefs against release thresholds;
6. one candidate is accepted, rejected or revised through the governed review path;
7. retained output passes people-blind and host-data-exposure checks;
8. the same MCP contract passes in the primary host and one second host;
9. cost, latency, failure and revocation stay within declared bounds;
10. deployment, backup, restore, rollback, offboarding and incident ownership are evidenced.

This proof does not require campaign lifecycle, Brand Lift or real-time monitoring.

## 20. Locked product decisions

1. Market Research is AI-native; the client's AI host is the primary user surface.
2. Remote MCP is the canonical host integration boundary for version 1.
3. Core owns durable research truth; host prompts and memory do not.
4. Version 1 supports competitor/positioning research for the D4WN Denmark pilot.
5. Version 1 starts with four tools and has an absolute maximum of six, one production ability and
   three production source paths.
6. The web application is a secondary administration/review surface.
7. The product is trend-first and people-blind and never creates consumer profiles.
8. Exact public excerpts are exceptional, reviewed and time-bounded.
9. Social/listening coverage is source-specific, permission-aware and never universal by promise.
10. Managed single-tenant is the default deployment; customer-operated single-tenant is an enterprise
    option. A shared multitenant data plane is unsupported.
11. No automatic cross-client learning from client content occurs.
12. Client specialization belongs in configuration, policy and evidence, not code forks.
13. Material recommendations and Market Twin updates require declared human review.
14. The `last30days` runtime and its approved legacy data path are removed through the R1A2/R1B
    gates; historical migrations remain immutable.
15. Campaign lifecycle, Brand Lift, broad monitoring and additional abilities are deferred until the
    first credible proof passes and product evidence justifies them.
16. Canonical maintenance follows the bounded R1A1b resource, artifact-projection and O(1)
    revocation contract in section 15.1 throughout legacy cleanup.

## 21. Open decisions

The roadmap may implement safe scaffolding but may not claim production completion until these are
resolved:

- primary launch host and second portability host;
- D4WN's exact competitor set and approved source inventory;
- first licensed listening/public-conversation provider and permitted commercial use;
- named research, source-rights, security and operational reviewers;
- approved cohort/suppression and raw/evidence retention values;
- production region, hosting owner and managed-service responsibility split;
- OAuth/IdP reference implementation and role mapping;
- pilot price, provider cost ownership and usage ceilings;
- DPA, subprocessors, DSR SLA and any DPIA requirement;
- service objectives, RPO/RTO and support terms;
- calibrated quality thresholds after the first live evaluation round;
- final customer-facing product name.

## 22. Deferred capability rule

After the minimum credible proof, the next ability is selected from actual pilot demand and measured
failure/gap data. Audience synthesis, proactive monitoring, campaign learning or study design must
compete for priority; none resumes automatically because code already exists.

The selected capability receives its own bounded job-to-be-done, source requirements, tool impact,
quality thresholds and paid pilot evidence before production activation.
