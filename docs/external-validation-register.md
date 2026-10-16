# External validation register

Updated: 2026-10-16

This register separates implemented product controls from evidence that only a client, source
owner, qualified reviewer, or production operator can supply. An empty evidence field means the
gate is open. It must not be inferred from a passing automated test.

| Gate | Required evidence | Owner | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| Pilot scope | Named client or approved representative dataset and signed source inventory | Unassigned | `needs_context` | — |
| Source rights | Permission, licence, terms assessment, purpose, quotation rights, and revocation path per source | Unassigned | `needs_context` | — |
| Data policy | Approved minimum cohort, suppression, evidence retention, and raw-retention values | Unassigned | `needs_context` | — |
| Live connectors | Credentials in secret storage plus provider acceptance and failure tests | Unassigned | `needs_context` | — |
| Research quality | Named qualified reviewer and scored representative/adversarial decision briefs | Unassigned | `needs_context` | — |
| Brand Lift | Named methodology reviewer and signed design/output-language review | Unassigned | `needs_context` | — |
| Monitoring | Shadow-mode signal volume, reviewer scores, noise/dismissal thresholds, and retest | Unassigned | `needs_context` | — |
| Production operations | Deployment owner, backup evidence, timed restore result, alerts, rollback and incident exercise | Unassigned | `needs_context` | — |

## Closure rule

A gate moves to `verified` only when its owner, date, scope, and durable evidence reference are
recorded. Conditional or partial approval remains `needs_context`, with the limitation stated.
Revoked or expired approval moves the gate back to `needs_context` or `blocked`.

