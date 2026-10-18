# R0B installation evidence and owner attestation

Status: **blocked — awaiting owner attestation**

Assessment date: 2026-10-18

Repository: `man-D4wn/Market-research`

Assessed revision: `2ca7155`

Applies before: Roadmap R1A2

This record is the redacted evidence index for the Roadmap R0B installation, recovery and owner-
acceptance gate. It may document either a verified-zero installation estate or every known
installation. It must not contain credentials, connection strings, secret values, personal data,
database rows, job payloads, request bodies or unredacted logs.

Repository evidence is discovery input, not proof that an external installation does not exist.
The status remains blocked until every authoritative scope below is complete, no unknown scope
remains, the recovery exercises pass and the required owners attest the conclusion with durable
evidence references.

## Repository-visible discovery

The following observations were collected read-only from revision `2ca7155` on 2026-10-18. They do
not close R0B.

| Surface | Redacted observation | Evidence state |
| --- | --- | --- |
| Local configuration | No `.env` or `.env.local` was present. `DATABASE_URL`, `TEST_DATABASE_URL`, `MARKET_RESEARCH_CLIENT_ID` and `MARKET_RESEARCH_CLIENT_SLUG` were unset. | Observed; local checkout only |
| Repository deployment definitions | The only deployment-shaped tracked file was `Dockerfile`. No tracked Compose, Terraform, Kubernetes, Helm, Vercel, Fly, Render, Railway, Procfile or service-unit definition was found. | Observed; current revision only |
| GitHub Actions | One CI workflow was present. It creates an ephemeral PostgreSQL 16 test service and contains no deployment job. | Observed; repository workflow only |
| GitHub repository configuration | Read-only repository queries returned zero repository Actions secrets, zero repository Actions variables, zero environments, zero deployment records and zero releases. Secret values were neither available nor requested. | Observed; repository scope only |
| Git remote | The configured remote was the source repository. A source remote is not a deployment record. | Observed; local checkout only |
| Local containers | No Market Research container was running in the selected local Docker context. | Observed; one machine and one context only |
| Installation credentials | No configured database/client scope was available, so `pnpm legacy:inventory` and `pnpm deployment:check` were not run against an installation. | Blocking limitation |

Commands and query outputs used for this observation must be retained only in approved encrypted,
access-audited evidence storage. Record their object identifiers and digests here; do not paste raw
environment output or credentials into this file.

| Evidence item | Durable object identifier | SHA-256 | Verified at | Verified by role |
| --- | --- | --- | --- | --- |
| Repository-visible discovery transcript | _required_ | _required_ | _required_ | `operations-owner` |
| GitHub repository metadata query | _required_ | _required_ | _required_ | `operations-owner` |

## Limitation and decision rule

The observations above cannot discover an older checkout, another repository or organization,
cloud resources, an externally managed database, a secret store, a local service on another
machine, copied scripts, process-manager jobs, scheduled tasks, webhooks, BI/reporting consumers,
traffic history, snapshots or backups. GitHub repository-level zero results do not prove that
organization- or environment-level resources are absent.

Do not infer `verified-zero` from repository silence. Until the authoritative perimeter is signed
off, the only permitted conclusion is `blocked — awaiting owner attestation`.

## Authoritative search perimeter

Use stable account or system identifiers in the protected evidence, not personal names or secret
values. Enter `none found`, an opaque installation ID, or `blocked`; never leave a scope implicit.

| Authoritative scope | Account/system scope identifier | Read-only method and observation window | Result | Durable evidence reference and digest | Owner role | Accepted at |
| --- | --- | --- | --- | --- | --- | --- |
| D4WN source and infrastructure repositories, including archived/private repositories | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| GitHub organization Actions environments, secrets/variables by name, deployments, releases and packages | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| Cloud and hosting organizations/projects/accounts | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| Managed PostgreSQL providers and self-hosted PostgreSQL servers | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| Database snapshots, backups, PITR archives and exported data | _required_ | _required_ | `blocked` | _required_ | `data-owner` | _required_ |
| Container registries, orchestrators and serverless platforms | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| DNS zones, reverse proxies, certificates and known application origins | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| Identity-provider applications and OAuth/OIDC clients | _required_ | _required_ | `blocked` | _required_ | `security-owner` | _required_ |
| Secret stores and CI/CD stores, checking names/references only | _required_ | _required_ | `blocked` | _required_ | `security-owner` | _required_ |
| Process managers, cron/schedulers, webhook jobs and operator machines | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |
| API clients, BI/reporting jobs, copied scripts and manual procedures | _required_ | _required_ | `blocked` | _required_ | `data-owner` | _required_ |
| Legacy route traffic evidence for `/brands`, `/runs`, `/insights` and their APIs | _required_ | _required_ | `blocked` | _required_ | `operations-owner` | _required_ |

If a listed scope does not exist, the accountable owner must record the authoritative system that
supports that conclusion and mark the row `none found`. `Not supplied`, `unknown`, an empty cell or
an unowned scope is a blocker.

## Installation registry outcome

Select exactly one outcome after completing the perimeter. Until then, keep the current outcome.

- [x] `blocked`: perimeter incomplete or owner attestation missing.
- [ ] `verified-zero`: the complete authoritative perimeter found no active or historical
      installation and no unregistered database or data copy.
- [ ] `installations-found`: every discovered installation or data copy is registered below.

Proposed conclusion: **blocked — awaiting owner attestation**

### Criteria for `verified-zero`

All of the following are mandatory:

- every perimeter row has a bounded read-only method, observation time, durable evidence reference,
  digest and accountable owner acceptance;
- `unknown`, `not supplied`, inaccessible and unregistered scopes equal zero;
- no application, worker, database, queue, schedule or endpoint is deployed or reachable;
- no PostgreSQL database, snapshot, backup or export containing Market Research or legacy data
  exists outside the registered recovery-exercise artifacts;
- no external producer, consumer, process, webhook, BI job or copied procedure depends on the
  legacy routes, queues or schema;
- secret stores contain no active legacy or installation credential reference; deletion or
  retention evidence exists for any historical reference;
- the operations and data owners jointly attest that the registry is complete; and
- the upgrade, backup/restore and owner-acceptance sections below are complete.

A verified-zero estate makes per-installation database inventory not applicable to the empty fleet;
it does not waive the representative upgrade, PostgreSQL-native restore or owner-acceptance gates.

## Per-installation alternative

Complete one record for every active installation, inactive installation, detached database or
retained backup/data copy. Use opaque IDs. Store the full inventory artifact outside the repository
as required by `docs/r1a1-legacy-inventory.md`.

### Installation record: `_opaque-installation-id_`

| Field | Redacted value or durable evidence reference |
| --- | --- |
| Registry state | `blocked` |
| Deployment mode | `single-tenant` / `inactive-data-copy` / `backup-only` |
| Hosting and database scope IDs | _required_ |
| Accountable deployment and data-owner roles | _required_ |
| Application and worker revision/image digest | _required_ |
| Process commands and replica counts | _required_ |
| Database engine/version and migration head | _required_ |
| Checksum-verified `legacy-inventory` artifact | _required_ |
| Read-only catalog and PgBoss evidence | _required_ |
| Legacy queue and monitoring-schedule disposition | _required_ |
| Legacy route traffic observation | _required_ |
| External consumers and operator procedures | _required_ |
| Secret references by name and retirement state | _required_ |
| Legacy data-class disposition | _required_ |
| Exceptions and remediation evidence | _required_ |

The installation record passes only when discovery is complete, client scope is validated, no
foreign/malformed tenancy or unresolved dependency exists, `research-run` has no `created`, `retry`
or `active` job, and every legacy data class and external dependency has an accepted disposition.

## Representative upgrade exercise

This must use a controlled representative pre-`0018` PostgreSQL database with legacy rows and apply
the immutable migration history through the current `0019_r1a1b_bounded_retention` head. Repository
CI is supporting implementation evidence, not this external exercise.

| Field | Required evidence |
| --- | --- |
| Exercise status | `blocked` |
| Isolated source snapshot identifier and checksum | _required_ |
| Source migration state and representativeness rationale | _required_ |
| Release revision and migration-history digest | _required_ |
| Start/finish timestamps and operator role | _required_ |
| Resulting migration head and integrity checks | _required_ |
| Legacy row/queue preservation checks | _required_ |
| Failure, rollback/forward-fix observations | _required_ |
| Durable report identifier and SHA-256 | _required_ |
| Data-owner acceptance as migration owner, with timestamp | _required_ |

## PostgreSQL-native backup and restore exercise

Restore into an isolated target with no production connector credentials. Start the same release
against the restored database and verify tenant counts, migration state and representative
artifacts without ad-hoc schema changes.

| Field | Required evidence |
| --- | --- |
| Exercise status | `blocked` |
| PostgreSQL-native backup method and opaque backup ID | _required_ |
| Recovery point and backup checksum | _required_ |
| Isolated restore-target identifier | _required_ |
| Start/finish timestamps, duration and measured RPO/RTO | _required_ |
| Migration, tenant-count and artifact verification | _required_ |
| Release startup/health verification | _required_ |
| Cleanup/destruction evidence for the exercise target | _required_ |
| Durable report identifier and SHA-256 | _required_ |
| Operations-owner acceptance and timestamp | _required_ |

## R1A2-entry canonical-maintenance decisions

For a verified-zero current fleet, record owner-approved `not applicable to current fleet` and the
gate that will require a measured decision before the first installation. Do not invent operational
values from repository tests. These decisions are separate R1A2 entry prerequisites; they are not
part of R0B and cannot keep the machine-readable R0B gate open after its own requirements pass.

| Decision | Status | Approved value or N/A rationale | Measurement/evidence reference | Owner role | Accepted at | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| Cleanup service objective | `blocked` | _required_ | _required_ | `operations-owner` | _required_ | first installation or material volume change |
| `0019` index-build maintenance window/method | `blocked` | _required_ | _required_ | `operations-owner` | _required_ | each installation and database-size change |
| Canonical-maintenance alert thresholds/escalation | `blocked` | _required_ | _required_ | `operations-owner` | _required_ | first installation or incident review |

## Owner acceptance

Acceptance must identify a durable, access-controlled evidence object. Do not enter signatures,
email addresses or other personal data in this repository record.

| Accountable role | Decision being accepted | Status | Durable acceptance reference and digest | Accepted at | Review/expiry |
| --- | --- | --- | --- | --- | --- |
| `operations-owner` | Complete installation perimeter, deployment evidence and recovery | `pending` | _required_ | _required_ | _required_ |
| `data-owner` | Complete database/backup perimeter and R1A2 preservation/access plan | `pending` | _required_ | _required_ | _required_ |
| `security-owner` | Identity, secret-store and access perimeter | `pending` | _required_ | _required_ | _required_ |
| `privacy-owner` | Retention, legal hold and destruction responsibilities | `pending` | _required_ | _required_ | _required_ |
| `d4wn-product-owner` | R0B conclusion and accountable role assignment | `pending` | _required_ | _required_ | _required_ |
| `commercial-owner` | Acceptance of the accountable commercial role recorded for later gates | `pending` | _required_ | _required_ | _required_ |
| `research-product-owner` | Acceptance of the accountable research-product role recorded for later gates | `pending` | _required_ | _required_ | _required_ |
| `source-integration-owner` | Acceptance of the accountable source-integration role recorded for later gates | `pending` | _required_ | _required_ | _required_ |
| `source-rights-owner` | Acceptance of the accountable source-rights role recorded for later gates | `pending` | _required_ | _required_ | _required_ |

The current governance validator requires all nine assignments in `product-decisions.json` to be
accepted before R0B can pass. Acceptance of a role does not decide the later decisions owned by that
role; each decision still remains governed by its own `requiredBefore` gate.

## Gate decision

| Gate | Current status | Closure requirement |
| --- | --- | --- |
| Installation registry | `blocked` | Complete perimeter and accepted `verified-zero` or complete every installation record |
| Representative upgrade | `blocked` | Passing external pre-`0018` through `0019` exercise with durable evidence |
| PostgreSQL restore | `blocked` | Passing timed native backup/restore exercise with durable evidence |
| Owner acceptance | `blocked` | All nine registered roles accepted with timestamps and durable evidence |
| R0B overall | **blocked — awaiting owner attestation** | Every R0B row above closed with no unknown scope |

Even after R0B passes, R1A2 remains blocked until the separate canonical-maintenance decisions in
the section above and every other R1A2 entry prerequisite are accepted.

Only after the evidence is independently verified should the machine-readable governance records be
updated. This template alone, a verbal assurance, repository CI or an unchecked zero count must
never be used to mark R0B passed or authorize R1A2.
