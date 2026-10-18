# R1A1 legacy inventory operator runbook

This runbook produces one read-only, aggregate legacy inventory artifact for one known
single-tenant installation. It does **not** complete R0B, approve a legacy-data disposition or
authorize R1A2. R1A2 remains blocked until R1A1b passes and every installation and every separate
R0B gate has accepted evidence.

## Preconditions

Before running the command:

1. Reconcile the authoritative installation registry. Every deployed database must have one
   opaque installation ID and an accountable owner; `unknown`, `not supplied` and unregistered
   installations are failing states. Do not use a client name, email or other identifying value as
   the installation ID.
2. Run from the repository revision being assessed. Set `APPLICATION_VERSION` to that immutable
   release or commit identifier when the deployment environment does not already provide it.
3. Use a dedicated database role with only `CONNECT`, required schema `USAGE` and `SELECT` on the
   referenced `public`, `drizzle` and `pgboss` relations. It must not have write, DDL, role,
   replication, bypass-RLS or broad administrative privileges. The command also opens a
   `REPEATABLE READ READ ONLY` transaction and refuses to continue unless PostgreSQL confirms it is
   read-only; that transaction is defense in depth, not a substitute for the SELECT-only role.
4. Pin the current installation in the environment with all three values:
   `DATABASE_URL`, `MARKET_RESEARCH_CLIENT_ID` and `MARKET_RESEARCH_CLIENT_SLUG`. The latter two
   must match the sole row in `public.client`; a missing value, mismatch or second client row makes
   the command fail closed. Do not print or copy `DATABASE_URL` into logs or evidence records.
5. Prepare a new path on approved encrypted storage. The location must be least-privilege,
   access-audited and covered by the installation's incident, legal-hold and deletion procedures.
   Do not use the repository, a shared temporary directory, a CI artifact with broad readership,
   chat, email or a ticket attachment. Record an approved expiry/destruction date before the run.

## Run

From the repository root, replace only the opaque registry ID and new output path:

```sh
pnpm legacy:inventory -- --installation-id OPAQUE_REGISTRY_ID --output /approved/encrypted/path/OPAQUE_REGISTRY_ID-legacy-inventory.json
```

The output path must not already exist and must not be a symbolic link. The command creates the file
exclusively with owner-only mode `0600`; it never overwrites an artifact. Stdout contains only JSON
with the resolved path, SHA-256 digest and discovery state. Complete discovery exits `0`. Failed
discovery still writes a checksum-bearing blocker artifact but exits `2`; retain it as evidence and
do not treat the run as passing. An operational failure before artifact creation exits non-zero and
must leave no new output file; inspect configuration and retry with a different new path.

The artifact contains counts, statuses, dependency metadata, validated tenant scope, digested
stored-manifest metadata and queue
state. It does not export source rows, handles, snippets, URLs, audit payloads, job payloads,
credentials or manifest bodies. Do not supplement it with ad hoc SQL dumps. Any later proposal for
an identity-bearing export is a separate governed operation requiring explicit approval, encryption,
least privilege, access audit, checksum, expiry/destruction and applicable legal-hold controls.

## Verify checksum

Verify immediately after collection and again before using the artifact. Point
`INVENTORY_FILE` at the stored JSON:

```sh
INVENTORY_FILE=/approved/encrypted/path/OPAQUE_REGISTRY_ID-legacy-inventory.json pnpm exec tsx --eval '
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson } from "./scripts/legacy-inventory.ts";
const artifact = JSON.parse(readFileSync(process.env.INVENTORY_FILE, "utf8"));
const recorded = artifact.checksum?.digest;
delete artifact.checksum;
const calculated = `sha256:${createHash("sha256").update(canonicalJson(artifact)).digest("hex")}`;
if (recorded !== calculated) { console.error("legacy inventory checksum mismatch"); process.exit(1); }
console.log(calculated);
'
```

Record the verified digest separately in the authoritative installation record together with the
operator, repository revision, collection time and storage object identifier. A match proves only
that the canonical artifact payload matches its embedded digest. SHA-256 here is an integrity check,
not a signature or MAC: anyone able to alter the file can calculate a new digest. It does not prove
who ran the command, that the database was truthful or complete, or that queue state has not changed
since the snapshot. Authenticity and chain of custody require the independent operator and storage
audit records.

## Interpret the artifact

The following must be present and internally consistent:

- `kind: "legacy-inventory"`, supported `schemaVersion` and `toolVersion`, and a plausible
  `generatedAt`;
- `discoveryState: "complete"` with no `discoveryFailures`;
- the requested opaque `installation.installationId`, `deploymentMode: "single-tenant"`,
  `clientScopeValidated: true` and `clientRowCount: 1`;
- `database.readOnlySnapshot: true`, the intended `database.applicationRevision`, and the recorded
  migration head;
- aggregate legacy table/status/field-presence counts, integrity anomalies, dependencies and stored
  ability-manifest relations;
- `queue` presence/version/configuration, every `research-run` state, tenant scope, malformed or
  foreign payload count, pending count and oldest pending timestamp;
- the documented limitations, especially that channel, market and legacy audit rows are not fully
  tenant-attributable in the current schema and queue state is only a point-in-time snapshot.

These are failing or blocking findings until investigated and durably resolved:

- a missing artifact, failed checksum, duplicate/unknown installation ID, registry installation
  without an artifact, or any `unknown`/`not supplied` installation;
- `discoveryState: "failed"`, any discovery failure, missing required relation or a partial PgBoss
  schema; retain the artifact as blocker evidence and require the command's non-zero exit;
- `clientRowCount` other than one, foreign tenant rows/jobs, malformed queue tenancy, or any non-zero
  integrity anomaly;
- migration state `missing` or `diverged`; `prefix` and `ahead` also block R1A2 until explicitly
  reconciled and the intended migration head is evidenced;
- any `research-run` job in `created`, `retry` or `active`, or any other pending count, until handled
  through supported PgBoss administration and re-inventoried;
- an `unknown` stored ability/version relation or a stored active/deferred manifest without an
  explicit disposition;
- dependent views or other database dependencies without an owner-approved forward-cleanup plan;
- any legacy rows or identity-bearing field-presence count without a recorded decision to retain for
  a bounded audit period, tombstone, delete, or perform a separately approved export.

A non-zero field-presence count is discovery evidence, not permission to export that field. A zero
count is not proof that every historical backup or other installation is clear. Completed, cancelled
or failed queue counts and ordinary legacy row counts are not automatically errors, but they still
require a documented disposition before destructive schema work.

## Store and close the run

Keep the artifact encrypted in transit and at rest. Restrict access to the named migration/data
reviewers, retain access logs, and record every read or transfer under the approved evidence process.
In the installation registry, record:

- artifact object/path identifier, embedded and independently recorded digest, generation and
  verification timestamps, operator and repository/application revision;
- database migration classification and head, legacy table counts, integrity findings and complete
  `research-run` queue state;
- owner and disposition for every legacy data class, including shared/unattributable tables and
  stored ability manifests;
- storage owner, permitted readers, legal-hold status, expiry/destruction date and eventual
  destruction evidence;
- any blocker, remediation ticket and the later inventory artifact that proves closure.

## R0B evidence checklist

The inventory portion of R0B is complete only when:

- [ ] the authoritative registry is signed off as complete;
- [ ] every registered installation has a successful, checksum-verified artifact and none is
      unknown or `not supplied`;
- [ ] each artifact records the intended revision, migration head, legacy counts and full
      `research-run` queue state;
- [ ] anomalies, foreign/malformed scope, pending jobs, dependencies and unknown/deferred manifests
      are resolved or explicitly block progression;
- [ ] every legacy data class has an owner-approved disposition and no identity-bearing export was
      created by this procedure;
- [x] the repository portion of the separate dependency audit is recorded in
      [the R1A1 dependency audit](r1a1-dependency-audit.md), covering imports, dynamic SQL,
      tracked database objects, declared queues/schedules and packaging;
- [ ] every installation has completed and owner-accepted the dependency audit's read-only catalog
      and PgBoss queries plus its deployment, external-consumer, traffic and secret-store evidence;
      the repository review and this artifact's catalog-only dependency section cannot satisfy that
      gate by themselves;
- [ ] encrypted storage, least-privilege access, access audit, retention/expiry, legal hold and
      destruction responsibility are evidenced.

R0B still additionally requires accountable owner-role acceptance with timestamps and durable
evidence, a representative pre-`0018` upgrade through `0018` with legacy rows, and a timed,
evidenced PostgreSQL-native backup restore. Completion of this runbook alone therefore neither
completes R0B nor authorizes R1A2. R1A2 also requires R1A1b to pass and every open item in
[the R1A1 dependency audit](r1a1-dependency-audit.md) to be complete and owner-accepted.
