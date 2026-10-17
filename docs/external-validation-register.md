# External validation register

Updated: 2026-10-17

This register separates implemented product controls from evidence that only a client, source
owner, qualified reviewer, or production operator can supply. An empty evidence field means the
gate is open. It must not be inferred from a passing automated test.

These rows are the bootstrap requirements. Per-client runtime state is recorded in the owned
`/evaluation` surface and `external_validation_gate` table. A verified research, Brand Lift,
monitoring, or production-operations gate additionally requires a passing scorecard of the matching
type. Expired evidence automatically presents as `needs_context`.

| Gate | Required evidence | Owner | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| Pilot scope | Named client, bounded brief and approved source inventory | Unassigned | `needs_context` | D4WN; positioning/competitor understanding in Denmark; owner brief 2026-10-17; source inventory not yet approved |
| Source rights | Permission, licence, terms assessment, purpose, quotation rights, and revocation path per source | Unassigned | `needs_context` | — |
| Data policy | Approved minimum cohort, suppression, evidence retention, and raw-retention values | Unassigned | `needs_context` | — |
| Live connectors | Registered source and synthesis adapters, credentials in secret storage, data-processing boundaries, provider acceptance and failure tests | Unassigned | `needs_context` | — |
| Research quality | Named qualified reviewer and scored representative/adversarial decision briefs | Unassigned | `needs_context` | — |
| Brand Lift | Named methodology reviewer and signed design/output-language review | Unassigned | `needs_context` | — |
| Monitoring | Shadow-mode signal volume, reviewer scores, noise/dismissal thresholds, and retest | Unassigned | `needs_context` | — |
| Production operations | Deployment owner, backup evidence, timed restore result, alerts, rollback and incident exercise | Unassigned | `needs_context` | — |

## D4WN bootstrap decision — 2026-10-17

The owner selected D4WN as the first pilot and confirmed there is currently no data and no earlier
D4WN synthesis connector to reuse. The follow-up brief resolves the initial decision and geographic
scope as well as client selection. It does not approve a model,
source permission, spend, collection job, method, human scorecard or production deployment.
No runtime gate is marked verified by this document update.

### Owner-provided pilot brief

- **Decision:** how D4WN should position itself for Danish marketing decision-makers, and how
  its intended offer compares with relevant competitors and alternatives.
- **Initial geography:** Denmark only. Scandinavia and Europe are later ambitions, not current
  research coverage or implicit collection permission.
- **Audience:** CMOs and marketing managers with decision authority. Customer organizations
  include marketing departments and marketing agencies; willingness to buy is not established.
- **Offer:** consulting that co-designs organizational structure and operating models with AI
  at the core, involves/educates/trains people, and subsequently builds a client-specific AI ecosystem.
- **Intended position:** the human and creative side of AI transformation; experienced consulting
  and meaningful client value rather than buzzwords or a ready-made product. Experience/expertise
  claims still require substantiation before use as externally verified claims.
- **Evidence status:** this is the owner's description of D4WN's intent, not market-validated
  demand, achieved outcomes, an accepted research finding or an automatically promoted Market Twin fact.

### Bounded research sequence

The maintained declaration can now be imported from `fixtures/d4wn/company-context.json` into the
tenant's `/company` surface. An owner/admin must inspect it and choose a review deadline/reason.
This is a reusable draft of the above owner brief, not a runtime gate approval. Profile versions
and optional aggregate CRM/sales source references remain separate from current research evidence.
Agent connection/service authorization and live business-data refresh are not activated by import.

1. Establish an approved source inventory and an explicit comparison rubric: audience, promise,
   organizational/operating-model work, human adoption/training, creative capability, implementation,
   proof and delivery model. Unknown details remain unknown, not negative competitor scores.
2. Map relevant competitors operating in Denmark, including international firms serving that
   market. Test consulting firms, specialist AI-transformation firms, agency/martech implementers
   and training-led alternatives as candidate categories, not an established competitive landscape.
3. Compare observable competitor claims and evidence, distinguishing supplier self-description
   from independent evidence of outcomes. Identify overlaps, contradictions and possible gaps.
4. Produce evidence-linked positioning options for D4WN with target relevance, necessary proof,
   trade-offs and counter-evidence. Do not declare a unique/defensible position from a small sample.
5. Recommend the next buyer-validation step. Competitor websites and public commentary alone
   cannot establish CMO purchasing priorities, willingness to pay or demand for the proposed offer.

The first deliverable is a reviewable competitor map and positioning decision brief, not a campaign
effect study or Brand Lift claim. Named competitors, source permissions, current buyer evidence,
D4WN proof points/cases, model acceptance and qualified review are still missing. Public evidence
can supply current market material once sources and use are approved; no historic customer dataset
is required to begin that bounded work. The brief does not activate collection or change runtime gates.
The optional synthetic-tested synthesis adapter remains disabled until provider selection and the
documented processing/quality/budget gates are satisfied. Existing synthetic fixtures stay visibly
synthetic and must not be promoted into D4WN's Market Twin as facts.

## Closure rule

A gate moves to `verified` only when its owner, date, scope, and durable evidence reference are
recorded. Conditional or partial approval remains `needs_context`, with the limitation stated.
Revoked or expired approval moves the gate back to `needs_context` or `blocked`.

