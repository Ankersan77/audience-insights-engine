# R0B installation evidence and owner attestation

Status: **verified-zero estate; blocked only on accountable role acceptance**

Assessment date: 2026-10-18

Repository: `man-D4wn/Market-research`

Assessed revision: `3669ea8`

Applies before: Roadmap R1A2

This record is the redacted evidence index for the Roadmap R0B installation, recovery and owner-
acceptance gate. It may document either a verified-zero installation estate or every known
installation. It must not contain credentials, connection strings, secret values, personal data,
database rows, job payloads, request bodies or unredacted logs.

Repository evidence is discovery input, not proof that an external installation does not exist.
The installation estate is now owner-declared and repository-corroborated as verified-zero. R0B
remains blocked until the accountable roles accept their assignments with durable evidence.

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
| Installation credentials | No configured database/client scope was available, so `pnpm legacy:inventory` and `pnpm deployment:check` were not run. | Not applicable to verified-zero estate; mandatory for first installation |

## Owner-declared installation estate

On 2026-10-18 the project sponsor explicitly confirmed that this product has not yet had a
permanent deployment, persistent database, backup or data copy that must be preserved. The
confirmation followed an explicit scope description covering hosted processes, permanent local
development databases, database dumps/snapshots, scheduled jobs, webhooks and legacy API
consumers. Ephemeral CI databases were excluded because they are created for tests and destroyed.

Together with the repository and repository-scoped GitHub discovery above, this establishes a
`verified-zero` current estate. There is no installation on which to run `legacy:inventory`, no
legacy row set to preserve and no external consumer to migrate. This declaration does not assign
the nine accountable governance roles, approve future production settings, establish an RPO/RTO,
or waive the R1A2 entry decisions.

Commands and query outputs used for this observation must be retained only in approved encrypted,
access-audited evidence storage. Record their object identifiers and digests here; do not paste raw
environment output or credentials into this file.

| Evidence item | Durable object identifier | SHA-256 | Verified at | Verified by role |
| --- | --- | --- | --- | --- |
| Redacted zero-estate declaration and repository discovery | `docs/r0b-zero-estate-evidence.json` | `48c84565d964358f0e1d06f24149de79645735e786951e1bf78ac66bf43467c5` | 2026-10-18 | project sponsor; accountable roles pending |
| GitHub repository metadata summary | `docs/r0b-zero-estate-evidence.json` | `48c84565d964358f0e1d06f24149de79645735e786951e1bf78ac66bf43467c5` | 2026-10-18 | project sponsor; accountable roles pending |

## Limitation and decision rule

The observations above cannot discover an older checkout, another repository or organization,
cloud resources, an externally managed database, a secret store, a local service on another
machine, copied scripts, process-manager jobs, scheduled tasks, webhooks, BI/reporting consumers,
traffic history, snapshots or backups. GitHub repository-level zero results do not prove that
organization- or environment-level resources are absent.

`verified-zero` is based on the sponsor's explicit whole-estate declaration, not repository silence
alone. A later discovery of any historical installation, database, backup or consumer immediately
invalidates this outcome and reopens the per-installation path before R1A2.

## Authoritative search perimeter

Use stable account or system identifiers in the protected evidence, not personal names or secret
values. Enter `none found`, an opaque installation ID, or `blocked`; never leave a scope implicit.

| Authoritative scope | Account/system scope identifier | Read-only method and observation window | Result | Durable evidence reference and digest | Owner role | Accepted at |
| --- | --- | --- | --- | --- | --- | --- |
| D4WN source and infrastructure repositories, including archived/private repositories | Current project scope | Sponsor declaration plus repository discovery | `none declared` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| GitHub organization Actions environments, secrets/variables by name, deployments, releases and packages | Current repository | Sponsor declaration plus repository-scoped GitHub metadata | `none found or declared` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| Cloud and hosting organizations/projects/accounts | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| Managed PostgreSQL providers and self-hosted PostgreSQL servers | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| Database snapshots, backups, PITR archives and exported data | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `data-owner` pending assignment | 2026-10-18 |
| Container registries, orchestrators and serverless platforms | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| DNS zones, reverse proxies, certificates and known application origins | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| Identity-provider applications and OAuth/OIDC clients | Current project scope | Sponsor whole-estate declaration | `none exist for this product` | This record; 2026-10-18 | `security-owner` pending assignment | 2026-10-18 |
| Secret stores and CI/CD stores, checking names/references only | Current project scope | Sponsor declaration plus repository-scoped GitHub metadata | `none exist for an installation` | This record; 2026-10-18 | `security-owner` pending assignment | 2026-10-18 |
| Process managers, cron/schedulers, webhook jobs and operator machines | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |
| API clients, BI/reporting jobs, copied scripts and manual procedures | Current project scope | Sponsor whole-estate declaration | `none exist` | This record; 2026-10-18 | `data-owner` pending assignment | 2026-10-18 |
| Legacy route traffic evidence for `/brands`, `/runs`, `/insights` and their APIs | Current project scope | No deployment exists, therefore no reachable route or traffic source exists | `not applicable — zero estate` | This record; 2026-10-18 | `operations-owner` pending assignment | 2026-10-18 |

For this pre-deployment project, the sponsor's explicit whole-estate declaration can mark a scope
`none exist`; repository-visible systems are additionally checked where they exist. `Not supplied`,
`unknown` or an empty cell remains a blocker. Formal accountable-role acceptance is tracked once,
separately, in the owner-acceptance gate below.

## Installation registry outcome

Select exactly one outcome after completing the perimeter. Until then, keep the current outcome.

- [ ] `blocked`: perimeter incomplete or estate outcome unknown.
- [x] `verified-zero`: the complete declared project estate found no active or historical
      installation and no unregistered database or data copy.
- [ ] `installations-found`: every discovered installation or data copy is registered below.

Conclusion: **verified-zero current installation estate**

### Criteria for `verified-zero`

All of the following are mandatory:

- every perimeter row has bounded scope, an explicit declaration or read-only observation,
  observation time and a durable evidence reference;
- `unknown`, `not supplied`, inaccessible and unregistered scopes equal zero;
- no application, worker, database, queue, schedule or endpoint is deployed or reachable;
- no PostgreSQL database, snapshot, backup or export containing Market Research or legacy data
  exists outside the registered recovery-exercise artifacts;
- no external producer, consumer, process, webhook, BI job or copied procedure depends on the
  legacy routes, queues or schema;
- secret stores contain no active legacy or installation credential reference; deletion or
  retention evidence exists for any historical reference;
- the sponsor's whole-estate declaration is recorded; and
- discovery of any contrary evidence automatically reopens the registry.

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

This uses a controlled representative pre-`0018` PostgreSQL database with legacy rows and applies
the immutable migration history through the current `0019_r1a1b_bounded_retention` head. For the
verified-zero pre-deployment estate, the isolated synthetic CI fixture is the applicable technical
exercise. Installation-specific upgrade proof becomes mandatory if an installation is discovered
or before a future upgrade of the first installation.

| Field | Required evidence |
| --- | --- |
| Exercise status | `passed — synthetic representative fixture` |
| Isolated source snapshot identifier and checksum | Generated isolated PostgreSQL 16 fixture; test SHA-256 `805684e01c8348462e6493372edfc3e97a0bfeb3f00eb04ddcee33b70898da72` |
| Source migration state and representativeness rationale | Head `0017_acquisition_budget_version`; representative rows in every listed legacy table |
| Release revision and migration-history digest | Revision `2ca7155`; immutable history applied through `0019_r1a1b_bounded_retention` |
| Start/finish timestamps and operator role | GitHub Actions run `39109907282`; automated isolated CI operator |
| Resulting migration head and integrity checks | All 19 migrations; required R1A1b tables, columns and indexes verified |
| Legacy row/queue preservation checks | Complete before/after JSONB snapshots of representative legacy rows were identical |
| Failure, rollback/forward-fix observations | Test database and temporary migration folder destroyed in `finally`; no production target |
| Durable report identifier and SHA-256 | GitHub Actions run `39109907282`; test digest above |
| Data-owner acceptance as migration owner, with timestamp | Covered by the separate pending accountable-role acceptance gate |

## PostgreSQL-native backup and restore exercise

Restore into an isolated target with no production connector credentials. Start the same release
against the restored database and verify tenant counts, migration state and representative
artifacts without ad-hoc schema changes.

| Field | Required evidence |
| --- | --- |
| Exercise status | `passed — synthetic native recovery fixture` |
| PostgreSQL-native backup method and opaque backup ID | PostgreSQL 16 `pg_dump --format custom` / `pg_restore`; ephemeral CI artifact |
| Recovery point and backup checksum | `2026-10-18T09:11:35.085Z`; `sha256:383b950b05cf77075c1608889bca3ec30b0706f763cc5469f361686a7e09273a` |
| Isolated restore-target identifier | Random CI database ending `_test`; destroyed after verification |
| Start/finish timestamps, duration and measured RPO/RTO | Backup 1,664 ms; restore command 839 ms; end-to-end synthetic recovery 1,466 ms. These are fixture timings, not production RPO/RTO. |
| Migration, tenant-count and artifact verification | 19 migrations; 2 clients, 1 project and 1 artifact matched; artifact payload verified |
| Release startup/health verification | Current build started against restore target and completed authenticated tenant-scoped `GET /api/projects` |
| Cleanup/destruction evidence for the exercise target | Source and restore databases dropped and temporary dump removed in test cleanup |
| Durable report identifier and SHA-256 | GitHub Actions run `39114254560`; test digest `4c01e8052f823c0b5bdee1fd0d4edcda214571fd3dc108595051c4587c1182e8` |
| Operations-owner acceptance and timestamp | Covered by the separate pending accountable-role acceptance gate |

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
| Installation registry | `passed — verified-zero` | Reopen immediately if any installation, database, backup or consumer is discovered |
| Representative upgrade | `passed` | Synthetic pre-`0018` through `0019` fixture in CI run `39109907282` |
| PostgreSQL restore | `passed` | Native isolated recovery and authenticated read in CI run `39114254560` |
| Owner acceptance | `blocked` | All nine registered roles accepted with timestamps and durable evidence |
| R0B overall | **blocked — accountable role acceptance only** | All nine role assignments accepted |

Even after R0B passes, R1A2 remains blocked until the separate canonical-maintenance decisions in
the section above and every other R1A2 entry prerequisite are accepted.

The sponsor declaration and repository discovery close only the empty-estate inventory. CI closes
the technical upgrade and restore exercises. Neither assigns accountable people, approves the
separate R1A2 decisions nor authorizes R1A2 while owner acceptance remains open.
