# ADR 0001: Rill access is an explicit, enumerated measure-and-dimension allowlist

- Status: Superseded; historical record only
- Date: 2026-10-08
- Initiative: `init-20261002-audience-insights-engine` (Audience Insights Engine)

## Context

> Superseded 2026-10-16: roadmap Phase 0 removed the adapter, workflow, active configuration, and
> allowlist implementation. This ADR is retained only to explain the historical decision and must
> not be used as justification for adding the provider to the new architecture.

This product must query Better Collective's internal Rill instance for two non-financial views (`organic_search_performance`, `playbook_event_stream`) while satisfying an absolute, non-negotiable requirement: commercial revenue and New Depositing Customer (NDC) data must never be queryable, stored, or surfaced by this product, under any configuration. Rill hosts many views that do contain revenue/NDC data (`commercial_revenue`, `affiliate_metrics`, every `business_central_*` view, `subscriptions`, `sponsorships`, `ad_cost`, `programmatic_revenue`, `engagement_subaffiliation`, `ai_spend_by_employee`).

## Decision

Rill access is controlled by `ALLOWED_RILL_MEASURES`, a hard-coded, non-admin-editable source constant enumerating every individual measure **and dimension** name permitted per view:

```text
ALLOWED_RILL_MEASURES = {
  "organic_search_performance": [...exact names...],
  "playbook_event_stream": [...exact names...],
}
```

Any view absent from this map, or any measure/dimension not explicitly named for its view, is rejected before a query is issued. A second, independent layer — a word-boundary-matched pattern filter (`revenue`, `ndc`, `commission`, `wagering`, `deposit`, `cost`, `spend`, `ggr`, `ngr`) — runs against whatever the allowlist permits, as defense in depth against a careless future addition to the allowlist itself.

The source file defining `ALLOWED_RILL_MEASURES` carries a CODEOWNERS entry requiring a named data-governance approver on any diff that touches it, and every query (and every rejection) is written to the audit log. The Rill service-account token issued to this product is separately requested to be scoped, at Rill's own permission layer, to exactly these two views — the application-level control is defense in depth, never the only layer. The allowlist's behavior is covered by a release-blocking CI test (against the full currently-known measure/dimension set of both views) plus a scheduled job that re-queries Rill's live schema and alerts on any unrecognised field.

## Alternatives considered and rejected

**Wildcard-allow per view, plus a denylist pattern filter** (`ALLOWED_RILL_VIEWS = {view: ALL_MEASURES}`, relying solely on the substring blocklist to catch financial fields). Rejected: this inverts the stated principle one layer down — an allowlist at the view layer but a denylist at the measure layer — and the blocklist alone would miss plausible real-world aliases (`clv`, `ltv`, `arpu`, `player_value`, `amount_eur`, non-English equivalents). Independently flagged as insufficient by both the tech-reviewer (blocking) and compliance-legal-reviewer (required) during expert review of `product-spec.md` v1.

**Runtime/admin-configurable allowlist.** Rejected: exposing this control in the admin UI, even to `admin`-role users, means a single UI action could weaken the one guarantee the entire product depends on. The allowlist is a compile-time constant requiring a code review and a data-governance approver to change.

## Consequences

- Adding a new Rill view or measure to this product always requires an engineering change reviewed by a named data-governance approver — this is the intended friction, not an oversight.
- A Rill schema change that silently adds a new field to an already-allowed view is caught by the scheduled live-schema drift check before it can leak through the application, not discovered after the fact in a report.
- The guarantee still depends on the Rill credential itself being properly scoped; this is tracked as an explicit open item (owner: the Rill administrator, to be named) rather than assumed.
