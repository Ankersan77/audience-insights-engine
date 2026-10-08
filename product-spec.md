# Audience Insights Engine — Product Specification

## 1. Metadata

| Field | Value |
|---|---|
| Initiative ID | `init-20261002-audience-insights-engine` |
| Initiative name | Audience Insights Engine |
| Owner | Patrick Johansen (pjohansen@bettercollective.com) — Publishing - Audience |
| Contributor | Martin (Publishing - Product) |
| Status | planning |
| Repository | `BetterCollective/better-craft-audience-insights-engine` (requested from BC Helpdesk, pending creation) |
| Spec version | v1 |
| Spec date | 2026-10-08 |
| Target milestone | First real report, US + Greece, end of November 2026 |

## 2. Dashboard Summary

**Summary** (synced to the initiative record):
> Detects attitudinal shifts per brand/market from the audience research corpus, allowlisted Rill data, and live social listening, surfacing explained insights to an approval queue routed to Slack/Drive. No revenue or NDC data.

**Highlights** (synced to the initiative record):
- Live social listening (Reddit/X/TikTok/YouTube) layered onto the internal audience corpus and Rill, per brand and market
- Revenue and NDC data are hard-blocked by an explicit Rill view allowlist, never a denylist
- One admin interface: connect brands, connect Slack/Drive channels, edit research instructions — no code change needed
- Insights queue for human accept/edit/discard before anything is published or routed

## 3. Executive Summary

Audience Insights Engine is an internal tool that answers "what changed, for this brand, in this market, and why" by combining three evidence layers — Better Collective's own audience research archive, a tightly restricted slice of internal behavioural data (Rill), and live public conversation (Reddit, X, TikTok, YouTube, Instagram, via the open-source `last30days` engine) — into a small number of explained, human-reviewed insights per brand. It replaces ad hoc, manually-assembled research (the kind produced by hand earlier this session for Action Network) with a repeatable, admin-configurable pipeline. It is not a BI dashboard and not a self-serve query tool: insights are curated, not browsed, and nothing reaches a Slack channel or a Drive folder without a human accepting it first.

The product has two faces. To the handful of admins who run it, it is one screen: connect a brand, connect the Slack channels and Drive folders that insights should land in, write or edit the research instructions that tell the engine what to look for, and trigger a run. To everyone downstream, it is a Slack message or a saved brief — they never see the tool itself.

One rule overrides every other design decision in this spec: **commercial revenue and New Depositing Customer (NDC) data must never be queryable, stored, or surfaced by this product, under any configuration.** This is enforced architecturally (Section 11), not by convention.

## 4. Problem Statement

Brand and market teams at Better Collective need to know when something has genuinely changed — a competitor move, a shift in how an audience talks about a brand, a new regulatory or platform risk — in time to act on it. Today that knowledge exists in three disconnected places: a ~160-artefact internal research corpus that is hard to search and goes stale; Rill, which answers questions someone already knows to ask; and the open public conversation (Reddit, X, TikTok, YouTube), which nobody at Better Collective is systematically listening to at all. Producing a report that synthesises all three — as was done manually for Action Network earlier this session — currently takes a skilled person a working session per brand, is not repeatable on demand, and does not scale to the 14+ brands and 16+ markets Better Collective operates in.

## 5. Business Goals and Success Metrics

**Business goal:** give brand and market stakeholders fast, trustworthy, explained answers to "what changed and why," at a fraction of the manual-research cost, without ever exposing commercial or NDC figures through this channel.

**Success metrics for v1 (by end of November 2026):**
- A first real, admin-triggered report is produced and delivered for at least one brand in each of the US and Greece markets.
- At least one admin (Patrick or Martin) can connect a brand, its channels, and its research instructions, and trigger a run, without engineering involvement.
- Zero occurrences of a revenue or NDC-bearing Rill measure appearing in any Evidence, Insight, or delivered output — verified by the allowlist enforcement test in Section 11.
- At least one insight is accepted and successfully routed to a real Slack channel or Drive folder end to end.

These are v1 adoption/trust metrics, not growth metrics; a formal "insight was acted on" metric is an open question (Section 16) pending agreement on who receives output and how success is judged.

## 6. Users and Jobs To Be Done

| User | Role | Job to be done |
|---|---|---|
| Admin (Patrick, Martin, and named colleagues) | `admin` | Connect a brand and its markets; wire Slack/Drive channels; write and edit research instructions; trigger a run; review the insight queue (accept/edit/discard) |
| Viewer | `viewer` | Read past insights and run history for brands they have access to, without being able to change configuration or approve anything |
| Insight recipients (brand/market stakeholders) | none (no login) | Receive an accepted insight in a Slack channel or a Drive folder; never interact with the tool directly |

No per-brand access restriction in v1 (decided in discovery): any admin can manage any brand. This is revisited if the brand/market list grows large enough that this becomes a real governance concern — logged as an assumption in Section 17.

## 7. User Journeys and Core Flows

**Journey A — Onboard a new brand (admin):**
1. Admin creates a brand (name, slug, markets).
2. Admin writes its research instructions: subreddits, X handles/related accounts, TikTok hashtags, named competitors, and a free-text focus description (the equivalent of today's manually-resolved Action Network configuration).
3. Admin connects at least one Slack channel or Drive folder as a delivery destination, and maps insight types to destinations (a sensible default mapping is pre-filled; Section 12).
4. Brand is now "ready to run" — defined as: has at least one Research Instruction and at least one mapped Channel. Until both are true, "Run now" stays disabled with a stated reason (FR10a), distinct from "a run is already in progress."

**Journey B — Trigger and review a run (admin):**
1. Admin selects a brand (and optionally a specific market) and clicks "Run now."
2. The run is queued as a background job (Section 11); the admin sees a status (queued → running → succeeded/failed) and does not block on it.
3. On success, the run's Evidence feeds shift-vs-blip detection (Section 8) and produces zero or more candidate Insights in `pending` status.
4. Admin reviews each pending insight: accept (routes to its mapped channel), edit (correct the text, then accept), or discard (with an optional reason).
5. Accepted insights are delivered and marked `routed`; the run and its insights remain visible in history.

**Journey C — Edit research instructions after a run reveals noise (admin):**
1. Admin notices a run surfaced off-topic evidence (e.g. a name collision, as documented from this session's Action Network research).
2. Admin edits the brand's research instructions (adds a disambiguating term, adjusts subreddits) — this is versioned (Section 8).
3. Next run uses the updated instructions; prior runs and insights are unaffected (history is immutable).

**Journey D — Viewer checks history:**
1. Viewer opens the tool, sees the brands they have access to (all brands, in v1), and browses past runs and insights read-only.

## 8. Functional Requirements

Each requirement is written so it can be verified directly.

**Brand & market management**
- FR1: An admin can create, edit, and archive a Brand (name, slug, free-text description, one or more Markets).
- FR2: An admin can add a Market to a Brand from a fixed reference list of country/region codes; the same Market can be attached to multiple Brands independently.
- FR3: Archiving a Brand stops it from appearing in the "run now" picker and does not delete its history.

**Research instructions**
- FR4: An admin can create and edit a Brand's Research Instruction: subreddits (dedicated vs. broad, matching `last30days`' own distinction), X primary/related handles, TikTok hashtags, named competitors, and a free-text focus description.
- FR5: Every edit to a Research Instruction creates a new version; a run always records which version it used, so a past run's configuration can be reconstructed exactly.
- FR6: A Research Instruction can optionally be overridden per Market within a Brand (e.g. different subreddits for a US vs. Greek audience); when absent, the Brand-level instruction applies.

**Channels & routing**
- FR7: An admin can connect a Slack channel (picked from a live list fetched from Slack, never typed blind) or a Drive folder (picked from a live Drive search/browse) as a Channel.
- FR8: An admin can map each Insight Type (Section 11) to one or more Channels, globally or per Brand; an unmapped Insight Type falls back to a configured default channel or is held un-routed with a visible warning.
- FR9: Drive-folder Channels are visible and manageable in the UI from v1, but routing to them is inert (recorded, not delivered) until a write-capable Drive credential exists (Section 16); the UI states this plainly next to the control, not as a hidden failure.

**Runs & evidence**
- FR10: An admin can trigger a Run for a Brand (optionally scoped to one Market) on demand; v1 has no scheduled/automatic runs.
- FR11: A Run executes as a background job; the triggering request returns immediately with a Run ID and status.
- FR12: A Run's status is one of `queued`, `running`, `succeeded`, `failed`, `cancelled`, visible in near-real-time in the UI. An admin can cancel a `queued` or `running` Run (UX review advisory 10; tech review advisory 13); a Run that exceeds its 10-minute timeout (Section 11) moves to `failed`, not `cancelled`, with a distinct "timed out" error.
- FR13: On `succeeded`, the Run has a set of normalised Evidence items, each tagged with its source (`reddit`, `x`, `tiktok`, `youtube`, `instagram`, `hackernews`, `polymarket`, `rill`, `drive`, `ga4` — the last three per Section 11's access rules).
- FR14: On `failed`, the Run records a plain-English error and which step failed (e.g. "last30days subprocess timed out", "Rill query rejected: view not on allowlist").

**Insight detection & review**
- FR15: Each successful Run produces zero or more candidate Insights, each with: a title, a one-paragraph explanation, a confidence indicator, a `shift` or `blip` classification, links to its supporting Evidence, and one Insight Type.
- FR16: Every candidate Insight starts in `pending` status and is never delivered automatically.
- FR17: An admin can `accept` (optionally editing the text first), or `discard` (optionally with a reason) a pending Insight.
- FR18: Accepting an Insight delivers it to every Channel mapped to its Insight Type for that Brand, and marks it `routed` with a timestamp; a delivery failure (e.g. Slack API error) is shown to the admin with a retry action, not silently dropped.

**Access & audit**
- FR19: A user signs in via the company's OneLogin SSO; there is no local password store.
- FR20: A user has exactly one role, `admin` or `viewer`, assigned by an existing admin.
- FR21: Every configuration change (brand, research instruction, channel, routing map) and every insight decision (accept/edit/discard) is written to an append-only audit log recording who, what, and when.
- FR22: A `viewer` never sees an admin-only control rendered on screen — it does not exist in their view, not merely disabled. `permission-denied` applies only to a viewer attempting direct URL/API access to an admin action, never to a visible, clickable control (UX review, required finding 1).

**Readiness, delivery-safety, and configuration-clarity (UX review, required findings 2–7)**
- FR10a: "Run now" is disabled with a stated reason for a Brand that is not "ready to run" (FR1 brand exists, but no Research Instruction or no mapped Channel) — a distinct reason and visual treatment from "a Run is already in progress for this brand."
- FR17a: Editing an Insight's text before accepting requires a confirmation step — showing the final text and the destination Channel(s) — before delivery fires.
- FR18a: A `routed` Insight whose delivery to a Channel failed is shown in its own "delivery failed" state (its own filter/badge in the queue), distinct from `pending`/`accepted`/`discarded`, with a retry action.
- FR6a: The research-instructions editor shows, per Market, an explicit "inherits brand default" or "overridden — reset to default" indicator. There is no implicit empty-row convention for "this market has no override."
- FR7a: The Slack-channel and Drive-folder pickers (FR7) are keyboard-navigable comboboxes with their own loading/empty/error states (e.g. "Slack unreachable," "no folders match"), specified independently of the screen-level states in Section 12.
- FR8a / FR9a: The "unmapped Insight Type" warning (FR8) and the "Drive routing recorded but not yet deliverable" warning (FR9) are each attached to a named screen — Channel management for FR9, Channel management and the Insight queue for FR8 — not left as requirements with no home screen.

## 9. Non-Goals and Out of Scope (v1)

- Not a self-serve BI/dashboard tool — users do not write their own Rill queries through this product.
- Not a scheduler — no automatic/recurring runs in v1 (Section 16 tracks this as a near-term follow-up).
- Not a GA4 or Drive-write integration until the corresponding credentials exist (Section 16); the admin screens for these exist so no re-design is needed later, but they do nothing until connected.
- Not a replacement for Rill, the audience research archive, or `last30days` — it orchestrates and curates across them, and does not reimplement any of them.
- Not a per-brand access control system in v1 (Section 6).
- Does not modify the vendored `last30days` engine's source; it is invoked as an external, versioned dependency (Section 11).
- Does not, under any configuration, expose `commercial_revenue`, `affiliate_metrics`, any `business_central_*` view, `subscriptions`, `sponsorships`, `ad_cost`, `programmatic_revenue`, `engagement_subaffiliation`, or `ai_spend_by_employee` data from Rill, nor any NDC figure, from any Rill view, in any output, log, or UI screen.

## 10. Data, Privacy, and Consent

**Triggers:** `personal-data`, `analytics-profiling`. Target markets: US and Greece at launch, more to follow.

**What is stored:**
- Public social-media evidence: post/comment text, public handle or username, engagement counts, and a URL, pulled from Reddit, X, TikTok, YouTube, and Instagram via `last30days`. These are public posts by design (the same data a human researcher would read directly on each platform), but a handle is still personal data in the general sense, so it is treated as such: never used to build a profile of an individual outside the context of the single Evidence item it came from, and never cross-referenced against GA4/Rill individual-level data (none is ever pulled — see below).
- Aggregate, non-identified audience/behavioural signals from two allowlisted Rill views (`organic_search_performance`, `playbook_event_stream`) and from GA4 once connected — both are aggregate analytics, not individual-level records.
- Better Collective employee identity (name, email, OneLogin subject ID, role) for the admins and viewers who use the tool.
- An audit log of admin actions (Section 8, FR21).

**What is never stored:** any revenue, NDC, commission, wagering, deposit, cost, or spend figure from Rill or any other internal system (Section 11); payment or financial information of any kind; data about end users of Better Collective's consumer products (this tool has no relationship to the consumer-facing identity/auth systems).

**Retention (compliance review, required):** Evidence containing `author_handle` is personal data under GDPR regardless of the source post being public, and Greece is a named EU/EEA launch market — public source does not exempt it. Indefinite retention with no enforcement mechanism is not acceptable as shipped. v1 builds a parameterized purge/anonymization background job (keyed on `evidence.retrieved_at`) now, so the actual ceiling is enactable the moment Legal sets it (Section 16) without a later schema or worker change; the job ships disabled (no default ceiling assumed) until Legal provides one.

**Lawful basis (compliance review, required):** no GDPR Article 6 basis is yet documented for collecting and storing identifiable social-media Evidence. The likely basis is Legitimate Interest (Art. 6(1)(f)); a Legitimate Interest Assessment covering both the US and Greek markets must be completed and recorded here before the social-listening pipeline processes production data (Section 16, blocking for Greece specifically).

**Sensitivity screening (compliance review, required):** because this product operates in the sports-betting domain, verbatim public post text quoted into `evidence.text_snippet` and surfaced in `insight.summary` can incidentally carry special-category content (Art. 9 — e.g. references to gambling addiction/health, political or religious opinion) tied to an identifiable handle. v1 adds a sensitivity flag (keyword list at minimum, LLM-assisted classification as a later improvement) at ingest; an Insight built from flagged Evidence requires explicit admin acknowledgement of the flag before it can be accepted, on top of the normal accept/edit/discard gate (FR17).

**Data subject rights (compliance review, required):** a social-media poster's GDPR Art. 17 (erasure) or Art. 21 (objection) request has no documented path today. v1 documents and implements a DSR procedure: database rows can be purged on request; a Slack message or Drive file already delivered before the request cannot be retracted, and that residual-risk disclosure requires Legal's explicit, recorded acceptance before launch (Section 16).

**LLM processing (compliance review, required):** the insight-drafting step (Section 11) sends Evidence — including Greek-market handles and text — to the company's existing LLM tooling. If that vendor is US-hosted, this is an international transfer of EU personal data. The vendor must be named and an existing DPA/Standard Contractual Clauses confirmed to cover this specific use before Greek-market Evidence is processed this way (Section 16, blocking for Greece).

**Minors:** not applicable — this tool has no end-user-facing surface; its only human users are Better Collective employees.

**Cross-border transfer / jurisdiction (compliance review, blocking for Greece):** Greece is a named, in-scope launch market, not a hypothetical, and GDPR fully applies to the identifiable social-media Evidence described above. Greek-market Evidence must not be stored or processed in production until Legal confirms (a) no additional Greek DPA registration/residency obligation applies beyond EU-hosted, in-cluster Postgres, and (b) the lawful-basis/LIA and LLM cross-border-transfer questions above are resolved for that market specifically. This does not block building or launching the US side of v1 (Section 16).

**Overall data classification (compliance review):** **Regulated** — not `internal` as earlier drafted. The initiative stores GDPR personal data (public social-media handle, text, and engagement tied to an identifiable individual) for an EU/EEA launch market, which sets the governing classification even though most other data (aggregate Rill/GA4 analytics, employee SSO identity) is only `internal`/`confidential` on its own. The commercial revenue/NDC data that must never be stored would itself be `restricted`/`regulated` if the Rill allowlist controls ever failed (Section 11).

## 11. Technology and Integration Signals

### Architecture overview

A single Next.js application (the platform template) plus:
- **PostgreSQL**, in-cluster (the chart's `groundhog2k/postgres` StatefulSet dependency), owning all relational data in Section 11's data model below.
- **A background worker** running `pg-boss` jobs for Run execution — a Run is enqueued on trigger, picked up by the worker, and never executes synchronously inside an HTTP request (`last30days` runs take 1–5 minutes). Concurrency is bounded (a configurable max of concurrent Run jobs, independent of how many brands exist) with explicit CPU/memory requests and limits on the worker Deployment, sized for running the Python subprocess below. The database's partial unique index on `research_run(brand_id, market_id)` (Section 11 data model) prevents two concurrent Runs for the same brand+market even on a double-submit or a race (tech review, required finding 7; devops review, required finding 7) — the UI's disabled "Run now" button (FR10a) is a usability affordance, not the enforcement. **Every Run job has an explicit timeout** (10 minutes — comfortably above `last30days`' normal 1–5 minute range) that moves a hung job to `failed` with a plain-English error rather than occupying a worker indefinitely (tech review, required finding 8). **Run jobs do not auto-retry**: a `failed` Run requires an explicit admin re-trigger (FR10), because `last30days` has already consumed third-party API quota (Reddit/X/TikTok rate limits) as a side effect of the attempt, and the `evidence` table's uniqueness constraint (Section 11 data model) makes any retry that does happen idempotent rather than duplicative (tech review, required finding 9).
- **`last30days` runs as a local subprocess of the worker, in the same container image — not a separate sidecar container** (revised from an earlier draft per devops review, required finding 1: the platform's CI/chart contract builds and deploys exactly one image per release, with no stock template for a second image or a second container in one pod). The vendored, unmodified `last30days` engine (MIT-licensed, pinned as a git submodule to a specific upstream tag — never patched in place, per this session's finding that it has no plugin/extension seam) is baked into the same multi-stage `Dockerfile` that builds the Next.js app, giving the worker container both a Node and a Python runtime. The worker invokes it as a local subprocess per Run (never over a network interface), reading its output directly rather than through an HTTP wrapper. This fits the platform's one-image/one-tag convention with no custom CI or chart change, and needs no `@BetterCollective/devops` sign-off beyond the standard code-owner review of the Dockerfile itself.

### Data model (PostgreSQL)

| Entity | Key fields | Notes |
|---|---|---|
| `brand` | id, name, slug (**unique**), description, status, created_by, created_at, updated_by, updated_at | `updated_by`/`updated_at` added for consistency with every other mutable table (tech review, advisory finding 10) |
| `market` | id, code, name | Reference list; not brand-owned |
| `brand_market` | brand_id, market_id, ga4_property_id (nullable) | Join table; GA4 property wiring lives here once credentials exist |
| `research_instruction` | id, brand_id, market_id (nullable), version, subreddits[], dedicated_subreddits[], x_handle, x_related[], tiktok_hashtags[], competitors[], focus_text, updated_by, updated_at | Versioned; **unique on `(brand_id, market_id, version)`**; a run references the exact version used |
| `channel` | id, type (`slack_channel`\|`drive_folder`), external_ref, display_name, created_by, created_at | **Unique on `(type, external_ref)`** so the same Slack channel or Drive folder can't be connected twice (tech review, advisory finding 11); `external_ref` is always picked from a live list, never typed |
| `insight_route` | id, brand_id (nullable = global default), insight_type, channel_id | |
| `research_run` | id, brand_id, market_id (nullable), research_instruction_version, triggered_by, status (`queued`\|`running`\|`succeeded`\|`failed`\|`cancelled`), started_at, finished_at, timed_out_at (nullable), error_message (nullable) | `cancelled` added as its own status (tech review / UX review, advisory) for an operator-ended stuck run; a **partial unique index on `(brand_id, market_id)` where `status in ('queued','running')`** enforces one active Run per brand+market at the database level, not just a disabled UI button (tech review, required finding 7) |
| `evidence` | id, run_id, source, external_id, url, author_handle (nullable), published_at, text_snippet, engagement_json, retrieved_at, sensitivity_flag (nullable) | `source` includes `rill`, `drive`, `ga4` alongside the social platforms; **unique on `(run_id, source, external_id)`** so a replayed/retried fetch cannot duplicate a row (tech review, required finding 9); `sensitivity_flag` added per Section 10's sensitivity-screening requirement |
| `insight` | id, brand_id, market_id (nullable), run_id, insight_type, title, summary, shift_or_blip, confidence, status, reviewed_by (nullable), reviewed_at (nullable), routed_at (nullable), delivery_status (`not_attempted`\|`delivered`\|`failed`) | `delivery_status` added per FR18a's distinct "delivery failed" state |
| `insight_evidence` | insight_id, evidence_id | Many-to-many |
| `app_user` | id, email, name, role, sso_subject_id, created_at, last_login_at | |
| `audit_log` | id, user_id, action, entity_type, entity_id, before_json, after_json, created_at | Append-only; includes changes to `ALLOWED_RILL_MEASURES` itself (Rill section, below) |

### Rill (internal BI) — access contract

Rill is reached from this product's backend via Rill's own API, using a dedicated service-account token (not the interactive MCP connection this planning session used, which only exists inside an agent session and is unavailable to a deployed service). Token ownership is an open item (Section 16).

**Enforcement is an explicit, measure-level allowlist, not a denylist, and not `ALL_MEASURES`** (revised per compliance review, required finding: granting every measure on an allowed view and relying on a substring blocklist to catch financial fields is a denylist wearing an allowlist's name, and the blocklist itself is incomplete — it would miss aliases like `clv`, `ltv`, `arpu`, `player_value`, or `amount_eur`). Every measure that may ever be queried is named explicitly, re-certified whenever the Rill schema changes:

```text
ALLOWED_RILL_MEASURES = {
  "organic_search_performance": ["avg_rank", "clicks", "impressions", "ctr"],  # exact measure names, re-certified against the live schema
  "playbook_event_stream": ["event_count", "funnel_stage", "channel"],
}
```

Any view not in this map, or any measure not explicitly named for its view, is rejected before a query is issued — including a measure added to an already-allowed view by a future schema change. The substring pattern filter (`revenue`, `ndc`, `commission`, `wagering`, `deposit`, `cost`, `spend`, `ggr`, `ngr`, case-insensitive, **word-boundary matched, not raw substring** — tech review, advisory: a raw substring match on `ggr` would wrongly strip an innocent field like `aggregated_sessions`) still runs as a second, independent layer against whatever the explicit allowlist permits, so a future addition to `ALLOWED_RILL_MEASURES` itself is still caught if it is named carelessly. This filter runs against **both measure and dimension names** returned from an allowed view (tech review, required finding 2 — a dimension such as a hypothetical future `revenue_bucket` grouping on `playbook_event_stream` carries the same financial semantics a measure would, and the original design only checked measures). The filter runs on the data as received from Rill and strips before anything is logged — no request/response logging around the Rill client ever captures the raw, pre-filter upstream payload, since a blocked value transiting the wire and then only being filtered at log-write time would itself violate Section 9's "never in any output, log" bar (tech review, advisory finding 6).

**This application-level control is defense in depth, not the only layer** (compliance review, required finding): before the Rill integration task starts, the service-account token Rill issues to this product must itself be scoped, at the Rill permission layer, to exactly `organic_search_performance` and `playbook_event_stream` — confirmed with whoever administers Rill (Section 16). An application bug must not be the only thing standing between this token and revenue/NDC data.

**Change control:** the source file defining `ALLOWED_RILL_MEASURES` carries a CODEOWNERS entry requiring a named data-governance approver (not an engineer alone) on any diff that touches it; such changes are also written to the audit log (compliance review, required finding). The allowlist check is covered by an automated test that is a named, release-blocking CI gate (devops review, required finding 16; tech review, required finding 4) — not merely "referenced as existing" — with two layers: (a) a unit test against the full currently-known measure and dimension set of both allowed views, so a wrong filter decision on a known name is caught at every CI run, and (b) a scheduled job that re-queries Rill's live schema for the two allowed views and **alerts** (not merely logs) if a measure or dimension appears that the unit test's fixture doesn't yet know about — a static fixture alone proves the filter works on names someone already thought of, not that nothing new has slipped in. A measure or dimension silently stripped by the pattern filter in normal operation (as opposed to a whole view being rejected) is its own alerting signal (Section 13), since a "successful" Run with a quietly dropped field can otherwise mask schema drift.

**ADR requirement (tech review, required finding 12):** both the Rill allowlist design above and the `last30days` subprocess architecture (below) are explicit Architecture Decision Record triggers under this repository's standing rules — a new external API dependency and regulated/sensitive data handling, and a new runtime (Python) alongside the Node/TypeScript stack, respectively. The implementation plan's first epic includes writing both ADRs from this section's reasoning before the corresponding code is built, per Rule 8 (a justified-complex addition must be recorded, not just built).

Views confirmed blocked by this allowlist today (informational, not an enumerated denylist in code): `commercial_revenue`, `affiliate_metrics`, `business_central_revenue`, `business_central_costs`, `business_central_ar_entries`, `business_central_ar_customer_summary`, `business_central_purchase_invoices`, `subscriptions`, `sponsorships`, `ad_cost`, `programmatic_revenue`, `engagement_subaffiliation`, `ai_spend_by_employee`, `group_kpis` (unreviewed, excluded by default), `switchboard` (excluded by default pending a decision on whether click-routing volume is in scope), `onetrust_cmp` (excluded by default — low relevance to v1 scope).

### Google Drive — access contract

Read/search access (listing brand-book and research-archive folders, reading document content) is proven reachable today via a Drive MCP connector in this planning session, but that connector is scoped to this session and is not available to the deployed app. Production needs its own Google service-account or OAuth credential with at minimum `drive.readonly` scope, scoped to the relevant shared drives/folders. Write access (to deliver an insight into a Drive folder) requires a broader credential that is explicitly being provisioned separately with IT (Section 16); until it exists, Drive-routing is recorded but not delivered (FR9).

### GA4 — access contract

No credential or connector exists anywhere in this environment today. GA4 access exists company-wide; per-brand/per-market property access is expected to be granted by a colleague to be named (Section 16). The `brand_market.ga4_property_id` column and the `ga4` Evidence source exist in the data model from v1 so that connecting a brand to GA4 later is a configuration action, not a schema change.

### Slack — access contract

Proven reachable today via a Slack MCP connector in this planning session (channel listing, messaging, file upload all confirmed live). Production needs its own Slack App with a bot token scoped to `channels:read`, `chat:write`, and `files:write`, installed to the Better Collective workspace. Token provisioning owner is named in Section 16.

### `last30days` — integration contract

- Vendored as a pinned git submodule pointing at `github.com/mvanhorn/last30days-skill` (MIT license), never modified in place.
- Invoked per Run with CLI flags derived directly from the Brand's current Research Instruction version: `--subreddits`, `--dedicated-subreddits`, `--x-handle`, `--x-related`, `--tiktok-hashtags`, and a generated `--plan` JSON file (the query-plan mechanism this session used manually), `--emit=compact`.
- Its own source credentials (Reddit works keyless out of the box; X requires `X_BEARER_TOKEN` or `XAI_API_KEY` since no interactive browser-cookie flow exists on a server; `SCRAPECREATORS_API_KEY` is optional, for TikTok/Instagram/transcript backfill) are stored in SSM like any other secret (Section 13), injected as environment variables on the worker container (the only container that ever invokes the subprocess), and are never read by the Next.js web process.
- Output (its compact Markdown report, including the evidence sections and footer stats) is parsed into `evidence` rows; the raw saved file is retained as an audit trail for the Run.

### Insight detection (v1 approach)

A Run's Evidence is compared against a trailing baseline (the same Brand/Market's recent prior Runs) across topic/sentiment distribution. A deviation corroborated across multiple sources and/or multiple items is classified `shift`; an anomaly resting on a single low-engagement item is classified `blip` and is still surfaced (visibly labelled) rather than silently dropped, since a blip can still be the first sign of something real. Candidate insight text is drafted using the company's existing LLM tooling (the same provider already tracked in Rill's `ai_spend_by_employee`) with a structured-output contract (title, summary, confidence, classification, evidence references) — never free-text that could omit required fields.

## 12. UX/UI, Look, Accessibility, Localisation, and SEO

- **Look:** agent's choice, clean and neutral (confirmed in discovery).
- **Showroom:** yes — this is an admin panel with more than three screens (brand list/detail, research instructions editor, channel management, insight queue, run history) and a shared navigation shell; the showroom of shared components is built as the first UI epic.
- **Theme source:** the project's own token system (internal app, not an embedded web component — no host page to inherit from).
- **Responsive:** mobile-first per the standing design rule, though this is primarily a desktop tool used at a desk; phone width must still render usably for a quick check from Slack.
- **Theme:** light and dark, system-default with a manual override, per the standing token contract.
- **State coverage:** every screen specifies loading, empty (e.g. "no brands yet — add one"), success, warning (e.g. "this channel routes here but Drive delivery isn't connected yet"), error (e.g. a failed Run), disabled (e.g. "Run now" disabled while a Run is already in progress, or because the brand isn't ready to run — FR10a), and permission-denied (a viewer attempting direct URL/API access to an admin action only — admin controls are never rendered to a viewer in the first place, so this is never a click-time block; UX review, required finding 1) states.
- **Accessibility status:** unverified as of this spec version — no build exists yet, so contrast, keyboard path, focus visibility, and labels cannot be measured. This is tracked as a **required gate**, not an assumed pass: a full accessibility check (`contrast_check.py` against the showroom's tokens, keyboard-path walkthrough of every critical task) is required once the showroom exists, and again before production launch. The Slack-channel and Drive-folder pickers (FR7/FR7a) are flagged in advance as the highest-risk components for keyboard/screen-reader access and get explicit acceptance criteria in the implementation plan.
- **Localisation:** the admin interface itself is English-only (internal tool, Better Collective's working language); this does not affect the language of the underlying evidence or insight content, which may quote non-English social posts or GA4 data from non-English markets verbatim — an open question (Section 16) is whether Insight summaries themselves should be localised per market or stay English-only.
- **SEO:** not applicable — internal tool, not indexed, no public surface.

## 13. Operations, Traffic, Deployment, and Observability

- **Artifact type:** persistent service (Next.js app + Postgres + background worker + `last30days` sidecar), on the better-craft platform.
- **Environments:** production only, per platform convention (merge to `main` is the deploy; no staging environment).
- **Secrets handling:** Rill service token, Google service-account credentials (Drive, later GA4), Slack bot token, and `last30days`' own source credentials (`X_BEARER_TOKEN`/`XAI_API_KEY`, optional `SCRAPECREATORS_API_KEY`) all live in SSM Parameter Store under `/better-craft/audience-insights-engine/production/`, referenced from the chart via `remoteRef`, read as `process.env.*` in code. No secret value is ever generated, typed, or committed by the agent. Each secret's owner must resolve to a named individual with AWS SSO access before its value can be entered (Section 16) — the path is set regardless. CI includes a guardrail check against any server secret leaking into a `NEXT_PUBLIC_*` variable or the client bundle (devops review, advisory).
- **Database backup and restore (devops review, blocking for release):** no backup schedule, retention period, RPO, or restore test exists yet for the in-cluster Postgres instance that owns every table in Section 11 — brands, research instructions, evidence, insights, and the audit log. This must be defined (schedule, retention, RPO) and a restore actually performed and timed, in coordination with `@BetterCollective/devops`, before production release; it is not a default the platform provides automatically (Section 16).
- **Migrations:** run as their own Job, kept forward-compatible (expand/contract) so an image rollback is never blocked by an irreversible schema change; each migration task in the implementation plan states its compatibility explicitly (devops review, required).
- **Rollback:** standard platform rollback — revert the merge commit that pinned the bad image tag; ArgoCD reconciles to the prior version. A migration is never reverted by an image rollback (see above). Owner: whoever merges the release PR, per the standard platform runbook.
- **Deployed URL:** `https://audience-insights-engine.better-craft.bettercollective.dev` (VPN/office network only, per platform default).
- **Worker shutdown:** the worker drains in-flight Runs (lets a running job finish, or safely requeues it) rather than killing it mid-`last30days`-invocation on a rolling pod replacement, which merge-to-main's frequent deploys make a routine occurrence, not an edge case (devops review, required).
- **Observability:** Run success/failure counts and duration, per-source Evidence counts per Run, Rill-allowlist-rejection count (should be zero in normal operation — a non-zero count is itself an alertable signal that something tried to query a blocked view), a separate stripped-measure count (a measure silently dropped by the pattern filter inside an otherwise-allowed view), Slack/Drive delivery failures. Logs are structured JSON to stdout via the platform's standard log collection; metrics are exposed for the platform's standard scrape/dashboard convention — the exact destination is confirmed against current platform tooling at implementation time (devops review, required) rather than assumed here. Alert on: worker queue depth **and** oldest-waiting-job age (devops review, required — depth alone misses a stuck-but-shallow queue), any Rill-allowlist rejection or stripped measure, repeated Run failures for the same brand.
- **SLOs (devops review, required):** a Run completes (success or failure) within 10 minutes of being queued; an accepted Insight is delivered to its Channel(s) within 30 seconds. A breach of either is the trigger for investigating the worker/sidecar-subprocess path first.
- **Capacity and cost (devops review, required):** Postgres storage grows unboundedly under indefinite Evidence/Insight retention (Section 10) until Legal sets a retention ceiling and the purge job (Section 10) is enabled — tracked as the same open item, not a separate one. LLM usage for insight drafting (Section 11) needs its own budget line against the company's existing LLM spend tracking, named at implementation time.
- **Runbook (devops review, required):** beyond the standard platform rollback runbook, this product needs documented procedures for: a stuck/long-running Run (how to identify and safely clear it), a Rill-allowlist-rejection spike (the alert tied to the product's single hardest compliance rule), a worker crash mid-Run, and a Slack/Drive delivery failure beyond the in-UI retry (FR18a).
- **Operational owner:** Patrick Johansen and Martin, Publishing teams, for the application; `@BetterCollective/devops` for the shared platform per standing convention.

## 14. Expert Brief Sections

### Product
An internal tool for a small number of Better Collective admins to configure per-brand research (internal corpus + allowlisted Rill + GA4 + live social listening) and review a curated insight queue before anything is delivered to Slack or Drive. Out of scope for v1: scheduling, GA4, Drive-write, per-brand access control. The one non-negotiable product rule — no revenue or NDC data, ever — is enforced architecturally, not by policy, and is the single most important thing a reviewer should stress-test.

### Tech
Platform-standard shape: one Next.js app, in-cluster Postgres, a pg-boss worker for background Run execution, running the vendored `last30days` Python engine as a local subprocess within the same container image (revised from an earlier sidecar-container draft, since the platform's CI/chart contract builds exactly one image per release). Verdict: **justified-complex, not over-engineered** — the subprocess pattern is the right call given `last30days` is CLI-only with no plugin/extension seam and must not be patched, and it adds no new network-reachable surface. The Rill allowlist is a hard-coded, non-admin-editable, measure-and-dimension-level constant (never `ALL_MEASURES`) with a word-boundary pattern filter as defense in depth, backed by a release-blocking CI test and a live-schema drift check. Two ADRs (the subprocess architecture; the Rill allowlist design) are required as the implementation plan's first deliverables. Three external integrations (Rill, Drive, GA4) each need their own, separately-provisioned service credential — none of them can reuse this planning session's MCP connectors in production; the Rill credential itself must be scoped at Rill's permission layer to the two allowlisted views, not just checked in application code.

### UX/UI
Core flows and screens map adequately to the five planned screens in outline, but several real states the functional requirements imply were missing from the original screen list: a "ready to run" / "not ready" indicator, a distinct "delivery failed" insight state with retry, a confirmation step before an edit-then-accept send, an explicit per-market inherit/override indicator on research instructions, and dedicated loading/empty/error states for the Slack/Drive picker components. All have been folded into Sections 7, 8, 12, and 15. Accessibility (contrast, keyboard path, focus, labels) is explicitly unverified until a build exists, and is tracked as a required gate at showroom-build time and again before production launch, not assumed satisfied by this spec.

### Compliance
Overall data classification is **regulated**, not merely internal — public social-media handles and text quoted into Evidence are GDPR personal data regardless of the source being public, and Greece is a named EU/EEA launch market. Required before Greek-market data is processed in production: a documented lawful basis (Legitimate Interest Assessment), a named LLM vendor with a confirmed DPA/SCC for the insight-drafting step, a sensitivity-screening flag on quoted text given the gambling-adjacent domain, a documented data-subject-rights (erasure/objection) procedure, and a parameterized retention/purge job built now so a ceiling is enactable the moment Legal sets one. The Rill allowlist's original wildcard-plus-denylist design at the measure level was flagged as insufficient and has been redesigned to an explicit, enumerated allowlist (Section 11) — independently confirmed by the Tech review as the same root issue.

### DevOps
The single-image subprocess revision (above) is required for deployability within the platform's stock chart and CI workflow; the original sidecar-container draft was not deployable without custom devops-owned changes. Before production release (not before implementation starts): a defined and tested Postgres backup/restore procedure (schedule, retention, RPO, one performed restore) — currently unspecified and release-blocking for any service owning a database — plus named observability destinations, two SLOs (10-minute Run completion, 30-second delivery latency), worker drain-on-shutdown behavior, and a product-specific runbook beyond the standard platform rollback steps.

## 15. Product Screens

Not yet captured — no running build exists yet. Planned screens for `initiative-screenshots` once built, expanded per UX review:
1. **Brand list** — empty and populated states; per-brand readiness indicator ("ready to run" / "not ready — &lt;reason&gt;", FR10a); archive and unarchive actions (FR3).
2. **Brand detail**, two sections on one screen: (a) brand fields (name/slug/description/markets, archive/unarchive — FR1–FR3); (b) research instructions editor, with a per-market inherit/override indicator (FR6a) and a read-only version-history list showing which version each past Run used (FR5; advisory finding 9).
3. **Channel management** — Slack-channel and Drive-folder pickers as keyboard-navigable comboboxes with their own loading/empty/error states (FR7a); the insight-type routing map; the unmapped-type warning (FR8a) and the inert-Drive-routing warning (FR9a) shown here.
4. **Insight review queue** — pending / accepted / discarded / **delivery failed** (FR18a, with retry) as distinct filters; a confirmation step before any edit-then-accept send (FR17a); scoped **globally across brands with a brand filter** (Decisions, Section 17), given the 14+ planned brands make a per-brand-only queue impractical for a reviewing admin.
5. **Run history and detail** — evidence breakdown, errors; a cancel action for an in-flight Run (advisory finding 10); a stale/stuck-run indicator when a Run exceeds a timeout without completing (advisory finding 11).

## 16. Open Questions

**Blocking (from expert review — do not treat as routine open items):**
- **Greece/EU launch (compliance-legal-reviewer, blocking).** Greek-market Evidence must not be stored or processed in production until Legal confirms: no additional Greek DPA registration/residency obligation beyond EU-hosted Postgres; a completed Legitimate Interest Assessment covering the lawful basis for collecting identifiable social-media Evidence; and a confirmed DPA/SCC for the LLM vendor used in insight drafting, specifically for this use. **This does not block building or launching the US side of v1** — it blocks Greek-market data only. Owner: Legal, to be named by Patrick/Martin.
- **Database backup and restore (devops-reviewer, blocking for release, not for starting implementation).** No backup schedule, retention, RPO, or restore test exists yet for the Postgres instance owning every table in this product. Must be defined and a restore actually performed, in coordination with `@BetterCollective/devops`, before production release. Owner: `@BetterCollective/devops`, coordinated by Martin/Patrick.

Carried forward from the original initiative, still unresolved:
- Where is "target audience" written down today — brand strategy docs, personas, or undocumented? (owner: Patrick/Martin)
- Who receives output in v1, and how many people? (owner: Patrick)
- What is the precise acceptance test for the first report (US + Greece, end of November)? (owner: Patrick/Martin)
- Should Insight summaries be English-only, or localised per market? (owner: Patrick/Martin)
- Can a recurring micro-survey start in week one? (owner: Patrick)
- Where does sports data live, and is it relevant to this product at all? (owner: Patrick)
- Media rights tracking — nothing currently watches it; is it in scope? (owner: Patrick)

New, from this planning session:
- **Who administers Rill and can issue this product its own service-account token, scoped to the two allowlisted views?** (owner: Martin, to identify — blocks the Rill integration task, nothing else)
- **Who administers GA4 and will issue per-brand/per-market property access?** (owner: Martin, to identify — blocks the GA4 integration task only; GA4 is deferred for all of v1 regardless)
- **Google Drive write credential** — being set up with IT (owner: IT, already in motion; blocks Drive-delivery only, not the rest of v1)
- **Slack bot token provisioning** — needs a named owner in IT/workspace administration (owner: IT, to be named; blocks Slack-delivery only)
- **Rill service-account scope confirmation** — the token issued to this product must be confirmed scoped, at Rill's own permission layer, to exactly `organic_search_performance` and `playbook_event_stream` (tech review, required finding 3) — folded into the existing "who administers Rill" item above; same owner.
- **Reviewer for `last30days` submodule version bumps** — third-party executable code running with live X/ScrapeCreators API credentials; needs a named person who reviews the upstream diff before the pin is moved (tech review, advisory 14). Owner: Martin, to assign.
- A retention policy for social-media Evidence specifically (Section 10) — owner: compliance-legal-reviewer, resolved in principle (a parameterized purge job ships disabled; Legal sets the actual ceiling) — the ceiling value itself remains open.

None of the above (other than the two blocking items above, which are release/market gates, not implementation gates) blocks starting implementation: the schema, UI, and `last30days` integration can all be built and tested against the two connectors already proven live in this session (Drive-read, Slack); Rill and GA4 integration tasks are explicitly sequenced after their credentials arrive (Section 17, and the implementation plan).

## 17. Decisions and Assumptions

**Decided (technical, agent's call):**
- Delivery mode: `internal-backend-tool`, on the better-craft platform.
- Auth: OneLogin SSO, no local password store.
- Datastore: PostgreSQL in-cluster; no Firestore (internal tool, not customer-facing).
- Background execution: pg-boss worker; Runs never execute synchronously in an HTTP request.
- `last30days` is vendored as a pinned git submodule and run as a local subprocess of the worker, inside the same container image as the rest of the app (revised from an initial sidecar-container design per devops review — the platform builds one image per release); never patched in place.
- Rill access is an allowlist, implemented as a non-admin-editable, measure-and-dimension-level code constant (never a wildcard grant), with a word-boundary pattern filter as a second, independent layer.
- Roles: `admin` and `viewer` only, no per-brand restriction, in v1.
- Insight review queue is scoped globally across brands with a brand filter, not per-brand-only (UX review) — the planned 14+ brand count makes a per-brand-only queue impractical for a reviewing admin.
- A `cancelled` Run status exists alongside `queued`/`running`/`succeeded`/`failed`, and every Run job has an explicit 10-minute timeout with no auto-retry (tech review).
- `evidence` and `research_run`/`channel`/`research_instruction` carry the uniqueness constraints listed in Section 11's data model, enforced at the database level, not only in application logic or the UI.

**Confirmed assumptions (from discovery, user-approved):**
1. On-demand runs only in v1; no scheduling.
2. End of November 2026 remains the target for the first real US + Greece report, now covering the merged scope.
3. Look: agent's choice, clean and neutral.
4. Admin/viewer is a sufficient role model for v1; no per-brand restriction needed yet.

**Open assumptions (not yet confirmed, flagged for the implementation plan to treat as provisional):**
- Insight summaries are English-only in v1 (pending the open question above).
- Evidence/Insight retention is indefinite in v1 pending a compliance-set retention ceiling.

## 18. Change Log

- **2026-10-08 (v1):** Initial spec authored, merging the original Audience Insights Engine concept (Patrick Johansen, Rill + audience corpus + shift detection) with a live social-listening layer (the `last30days` engine, wrapped as an external subprocess) and a single admin interface for brand/channel/research-instruction management, following a same-day research session that produced a worked example (the Action Network market brief) and resolved the Rill view allowlist, the Drive write gap, and the GA4 credential gap. Martin (Publishing - Product) added as contributor.
- **2026-10-08 (v2):** Incorporated all four expert reviews (tech, UX, compliance, devops), dispatched in parallel against v1:
  - **Architecture revised:** `last30days` moved from a separate sidecar container to a local subprocess inside the worker's own container image, since the platform builds exactly one image per release (devops, required).
  - **Rill allowlist redesigned:** replaced `ALL_MEASURES` + a denylist with an explicit, enumerated measure-and-dimension allowlist, word-boundary pattern matching, a release-blocking CI test plus a live-schema drift alert, a CODEOWNERS gate, and a requirement to confirm the service-account token itself is scoped at Rill's permission layer — independently flagged as blocking by both tech-reviewer and compliance-legal-reviewer.
  - **Data classification raised to `regulated`**; added lawful-basis, sensitivity-screening, data-subject-rights, LLM-cross-border-transfer, and retention/purge requirements (compliance, required); flagged the Greece/EU launch as blocking pending Legal sign-off (compliance, blocking — US launch unaffected).
  - **Reliability hardening:** DB-level duplicate-run prevention, explicit Run timeouts, no auto-retry on Run jobs, an `evidence` uniqueness constraint, a `cancelled` Run status (tech, required/advisory).
  - **Release readiness:** flagged Postgres backup/restore as undefined and release-blocking; added SLOs, additional alerting, worker drain-on-shutdown, migration/rollback compatibility, and a product-specific runbook (devops, required/blocking).
  - **UX fixes:** corrected the viewer permission-denied pattern, added the "ready to run" state, a delivery-failed insight state, a pre-send confirmation step, per-market inherit/override indicators, and picker-component states; expanded Section 15's screens accordingly (UX, required).
  - Two ADRs (Rill allowlist design; `last30days` subprocess architecture) added as required first deliverables of the implementation plan (tech, required).
