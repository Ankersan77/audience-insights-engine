# Market Research

Market Research is an AI-native, client-isolated evidence intelligence service for marketing
decisions. Users access it from their company's chosen AI host through a versioned remote MCP
contract. The first production target is a source-backed competitor and positioning brief for the
D4WN Denmark pilot.

The product is trend-first and people-blind. It studies populations, themes, behaviors and changes
without building consumer profiles or cross-platform identity graphs.

## Source of truth

- [`BLUEPRINT.md`](BLUEPRINT.md) — canonical product, architecture, governance and release contract.
- [`ROADMAP.md`](ROADMAP.md) — canonical trim-and-build sequence.
- [`docs/blueprint-audit-2026-10-17.md`](docs/blueprint-audit-2026-10-17.md) — evidence and rationale
  for the v2 reset.
- [`product-spec.md`](product-spec.md) and [`implementation-plan.md`](implementation-plan.md) —
  compatibility pointers for legacy links only.

Machine-readable governance is kept in `compatibility-manifest.json`,
`product-capabilities.json`, `product-decisions.json` and `r0-baseline.json`. Run
`pnpm check:governance` to detect scope, dependency, version, route, queue, table and migration drift.

## Version 1 product boundary

Version 1 has:

- one production ability: `competitor-positioning-research`;
- one primary geography: Denmark;
- three source paths: approved client documents, trusted public/official web, and one approved
  licensed listening/public-conversation provider;
- four initial MCP tools, with an absolute maximum of six;
- one canonical `decision-brief@2` output;
- a narrow web surface for company context, sources/rights, review, quality and operations;
- managed single-tenant as the default deployment and customer-operated single-tenant as an
  enterprise option.

Campaign lifecycle, Brand Lift, proactive monitoring, broader audience research and additional
abilities are deferred. Existing implementation for those areas is not a supported v1 product and
will be parked or removed through the roadmap.

## Architecture

The target path is:

```text
AI host → remote MCP → application services/Core → client-isolated data plane → approved sources
```

The AI host owns the conversation, not product truth. Core owns authorization, source selection,
research method, claim state, evidence lineage, review and durable artifacts. Host packages contain
no client facts, credentials or duplicated research logic.

The implementation stack currently uses:

- Next.js 16 and React 19;
- PostgreSQL with Drizzle ORM;
- `pg-boss` durable background jobs;
- a hardened browser OIDC/session flow;
- provider-neutral evidence, acquisition and synthesis contracts.

Remote MCP, agent OAuth and the application-service boundary are roadmap work; they are not yet
implemented. OneLogin-named browser configuration is a current reference implementation, not the
target provider-neutral agent identity contract.

## Transition status

The repository predates Blueprint 2.0.0 and still contains implemented campaign, Brand Lift and
monitoring surfaces. They must not be treated as active v1 product claims.

Roadmap R1A2 removed the `last30days` runtime, Python dependency, submodule, routes and legacy
application workflow. R1B migration `0020_r1b_legacy_schema_cleanup` removes the separately
approved legacy tables and identity-bearing fields without changing historical migrations. The
pre-migration boundary is recoverable at annotated tag `pre-r1b-v2.1.0`.

The canonical production source registry is empty until live adapters pass source-rights,
people-blind, cost, failure and provider acceptance. Synthetic adapters and fixtures prove contracts,
not live research quality.

## Requirements

- Node.js 24
- pnpm 11
- PostgreSQL 16+

## Local setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

The current transition application is available at `http://localhost:3000`; `GET /healthz` is the
container health endpoint.

## Environment and access

Required variables and transitional provider-specific names are documented in `.env.example`.
Never commit credentials.

The current browser application requires:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ONELOGIN_DISCOVERY_URL`
- `ONELOGIN_CLIENT_ID`
- `ONELOGIN_CLIENT_SECRET`

Explicitly provision the exact browser OIDC subject with:

```bash
pnpm access grant --client CLIENT_SLUG --subject OIDC_SUBJECT --role ROLE
```

OIDC proves identity but never grants product membership automatically. Agent/MCP identity will use
a separate OAuth bearer path; a human browser cookie must never be reused as an agent credential.

New source work must use canonical adapters and the minimization policy.
`ENABLE_ENV_CREDENTIAL_RESOLVER` remains disabled by default and, when
explicitly enabled for the current transition runtime, accepts only client-scoped opaque references.

## Commands

```bash
pnpm dev                    # local transition application
pnpm lint                   # ESLint
pnpm typecheck              # generated Next.js types plus TypeScript
pnpm test                   # deterministic unit/fixture tests
pnpm test:integration       # requires dedicated TEST_DATABASE_URL ending in _test
pnpm check:source-of-truth  # canonical documentation check
pnpm build                  # production build
pnpm build:worker           # build the standalone canonical worker artifact
pnpm worker                 # run the built canonical worker artifact
pnpm worker:dev             # run the canonical worker directly in development
pnpm db:generate            # create forward migrations
pnpm db:migrate             # apply migrations
bash verify.sh              # complete local gate
```

Production orchestration must give `worker-runtime` at least 330 seconds between SIGTERM and
SIGKILL. The worker's bounded maintenance handler may run for 240 seconds and its PgBoss drain
window is 300 seconds; a shorter container grace period can corrupt the shutdown contract.

## Current verification boundary

The repository has extensive deterministic coverage for tenant scope, evidence policy, claims,
rights, retention, budgets, campaigns, studies and monitoring. Passing those tests is implementation
evidence only. It does not prove remote MCP support, live source coverage, human research quality,
external OIDC, production restore or commercial readiness.

The CI workflow runs source-of-truth checks, lint, typecheck, deterministic tests, production build,
PostgreSQL integration/authenticated HTTP tests, both production-image builds, removed-route checks
and a canonical worker image start/drain/restart exercise.

## Deployment

The Dockerfile exposes separate `web-runtime` and `worker-runtime` targets from one revision. Deploy
the web target with its HTTP health check and the worker target with process-liveness supervision;
do not override the web image command to run a worker. The broader deployment remains transitional
until R3-R7 add remote MCP/agent identity and prove the managed single-tenant reference deployment.

Do not describe an installation as production-supported until its current source, quality, host,
security, recovery and operations evidence is recorded and valid.
