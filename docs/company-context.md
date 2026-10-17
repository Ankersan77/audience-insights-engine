# Maintained company context

The PostgreSQL `company_context_revision` table (migration `0018`) is the tenant-local system of
record. `/company` is the owned read/edit surface. The latest revision is current; the last 50
revisions are visible in history. Business declarations are retained until an explicit client
retention/offboarding policy removes them; there is no automated history purge in this slice.
Do not enter credentials, consumer/contact records or raw CRM exports. Text screening is heuristic,
not a guarantee of anonymization, secret detection or prompt-injection immunity.

## D4WN bootstrap

After applying the migration to the intended environment, an owner/admin opens `/company`, imports
`fixtures/d4wn/company-context.json`, checks the content, chooses a review deadline (future UTC date,
at most 366 days away), supplies a change reason and saves. Import only fills the form. The content
comes from the owner's Danish positioning/competitor brief; it is not fabricated research or an
automatic assertion that demand/differentiation is proven. No runtime D4WN tenant is selected or
modified by committing this file. There is no automatic profile refresh or deadline extension.

## Core contract and future agent

`GET /api/company-context` uses the authenticated session's tenant and returns `company-context@1`,
`available` or `needs_context`, the current declaration (or null), gaps and use guidance. It is
private/no-store and rejects query selectors. A future agent must read current context for each
task and respect gaps. This is a session-scoped API seam, **not** service-account/MCP authentication;
do not give an agent a human session cookie as a deployment integration. Select the host/transport
and implement revocable, least-privilege service access before connecting an autonomous agent.

`POST /api/company-context` accepts only `expectedVersion` (null for first creation), `content`,
`reviewAfter` and `changeReason`. Only current tenant owner/admin sessions may publish. Edits append
a new revision and metadata-only audit atomically. Stale editors receive 409 and must reload and
reconcile; uncertain saves must be checked before retry. No model or connector may update strategy.

Core loads the profile for research without manual prompt copying. A declared profile that is
overdue, invalid or outside the requested scope blocks contextual research. Existing tenants without
a declaration continue on the reviewed Market Twin path; absence is explicit in the profile API
and historical basis. A declaration does not substitute for the reviewed records/evidence required
by an ability. An optional synthesis transport must additionally permit `client_owned` data.

Research/campaign basis records retain company version and digest. Persistence and guarded review
revalidate the current declaration under a shared lock; editing takes the matching exclusive lock,
including when no prior revision exists. Prior work is not rewritten when strategy changes.

## Business data versus strategy

Source bindings have purposes `strategy`, `crm_aggregate`, or `sales_aggregate`. The first must refer
to a same-client `client_owned` connection; the latter two to `first_party_aggregate` connections.
Bindings are references only, not activation, consent, source-policy overrides, evidence selection
or synchronization. A referenced source must separately be configured in the solution's permitted
bindings before evidence enters research. Its values, dates, populations, method, cohort suppression,
rights and freshness stay in the existing canonical evidence/quantitative-observation layer.

Still open: chosen CRM/sales system and minimum aggregate schema; accepted connector, credentials,
refresh cadence and data policy; agent host/service identity; transfer/remapping of company profiles
between installations. The reusable solution bundle intentionally contains no company strategy or
customer data. These choices do not block maintaining the D4WN declaration now.
