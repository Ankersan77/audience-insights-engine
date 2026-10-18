# Phase 0 legacy integration inventory

> Historical inventory. Roadmap R1A2 removed the retained runtime and application surfaces; the
> separately approved R1B forward migration subsequently removes the identity-bearing legacy
> schema. This file describes the pre-removal state only.

Date: 2026-10-16
Blueprint at time of inventory: pre-2.0 reset

This is the reviewed deletion/generalization manifest for the former Slack/Rill product model.
Slack and Rill are not optional modules of the target product; they are removed from active runtime,
configuration, navigation, readiness, acceptance, tests, and CI.

## Removed

| Legacy area | Removed surface | Replacement |
| --- | --- | --- |
| Slack API | `src/lib/slack.ts`, Slack search route | Provider-neutral `DeliveryAdapter` contract; no external delivery in the current UI |
| Rill API | `src/lib/rill.ts`, allowlist and tests, Rill evidence worker | `MetricSourceAdapter` and `EvidenceSourceAdapter` contracts |
| Scheduled Rill check | `.github/workflows/rill-schema-check.yml` | Connector contract tests and ordinary CI |
| Channel management | `/channels`, channel and route APIs, Slack/Drive pickers | Future destination setup through provider-neutral adapters |
| Insight delivery | accept-and-send, delivery retry/filter/SLO | In-product accept/discard review only |
| Configuration | Slack, Drive-delivery, and Rill environment variables | Opaque credential references resolved by adapters at runtime |
| Ownership rule | Rill-specific `CODEOWNERS` gate | Repository-wide ownership by `@man-D4wn` |
| Product branding | Legacy organization and Audience Insights runtime copy | Market Research |

## Generalized

- `src/connectors/contracts.ts` defines `EvidenceSourceAdapter`, `MetricSourceAdapter`,
  `DeliveryAdapter`, `SourceAcquisitionJob`, and `SourceAcquisitionReceipt`.
- Persisted acquisition messages carry tenant scope, safe selectors, opaque credential references,
  idempotency data, and counts. They do not carry credentials or raw provider payloads.
- Brand readiness now depends on research instructions, not a mapped delivery channel.
- Insight acceptance records an audited in-product review decision without contacting an external
  destination.

## Retained as historical compatibility

| Surface | Why it remains | Removal condition |
| --- | --- | --- |
| `decisions/0001-rill-allowlist.md` | Immutable decision history, explicitly marked superseded | Never required; archive with the repository |
| `drizzle/0001_init.sql` and migration snapshots | Applied migrations must not be rewritten | Never rewrite; later migrations may supersede the schema |
| Legacy `channel`, `insight_route`, `channel_type`, `delivery_status`, and `routed_at` schema fields | An additive migration is safer than destructive Phase 0 cleanup | Remove only after a replacement schema is proven and a data migration/rollback plan exists |
| Historical audit/database values | Operational history must remain interpretable | Govern through retention policy, not code deletion |

## Follow-up risks

- The legacy evidence table still includes `author_handle`. Phase 2 must replace it with the
  people-blind evidence contract and migrate or purge old data before production ingestion.
- The old engine and its runtime packaging were removed in R1A2. Any future social/listening source
  must enter through the canonical adapter, rights, provenance and people-blind gates.
- Legacy database fields are not product requirements and must not be used by new features.
