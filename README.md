# Market Research

Market Research is a reusable, client-configurable market intelligence and campaign-learning
product built on D4WN principles. It combines governed client evidence, commissioned research,
aggregate behavioral and commercial signals, official/public sources, and permitted public
conversation into a versioned **Market Twin** and decision-ready research outputs.

The product is trend-first and people-blind: it studies populations, themes, behaviors, and changes
without building consumer profiles or cross-platform identity graphs.

## Source of truth

- [`BLUEPRINT.md`](BLUEPRINT.md) — canonical product, architecture, data, research, and quality
  contract.
- [`ROADMAP.md`](ROADMAP.md) — phased build plan and release gates.
- [`product-spec.md`](product-spec.md) and [`implementation-plan.md`](implementation-plan.md) —
  compatibility pointers for legacy links only.

## Stack

- Next.js 16 and React 19
- PostgreSQL with Drizzle ORM
- `pg-boss` background jobs
- OneLogin OIDC authentication
- Provider-neutral evidence, metric, source-acquisition, and delivery adapters (target architecture)
- A pinned `last30days` research engine in `vendor/last30days`, retained as disabled migration
  scaffolding; it is not part of the canonical people-blind ingestion path

Provider-specific integrations belong behind the connector contracts in
`src/connectors/contracts.ts`; none is required to build or run the core product.

## Requirements

- Node.js 24
- pnpm 11
- PostgreSQL
- Git submodules enabled

## Local setup

```bash
git submodule update --init --recursive
corepack enable
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

The application is available at `http://localhost:3000`. Its health endpoint is `GET /healthz`.
The authenticated `/workspace` surface configures governed sources and onboards extracted text,
Markdown, CSV, JSON, or permitted public-link content into canonical evidence. PDF and office-file
extraction must be supplied by a verified document adapter; the application never stores the raw
upload as a substitute for that boundary.

The same owned surface provides reviewed Market Twin records and persistent decision briefs.
`/campaigns` handles campaign revisions, measurement-plan and study review, pre-flight/live/post
assessments, governed learning, and lifecycle transitions. Requesting Brand Lift never bypasses
the deterministic causal-design gate. `/monitoring` manages versioned sensing profiles and durable
tenant-scoped runs; `/configuration` manages portable solution-profile versions and redacted
exports.

## Environment variables

Required and optional variables are documented in `.env.example`. Keep real values in local or hosted secret storage; never commit them.

The minimum application setup requires:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ONELOGIN_DISCOVERY_URL`
- `ONELOGIN_CLIENT_ID`
- `ONELOGIN_CLIENT_SECRET`

New connectors must use opaque credential references and the provider-neutral contracts in the
blueprint.

`ENABLE_LEGACY_LAST30DAYS` defaults to `false`. Do not enable it for production ingestion; new
sources must pass through the canonical evidence adapters and minimization policy.

## Implementation status

The repository implements and tests the canonical contracts, additive data model, tenant scope,
people-blind evidence boundary, Market Twin transitions and resolution, four core research
abilities, campaign lifecycle analysis, measurement and Brand Lift guardrails, selective
monitoring, solution packaging, and operational resilience. `/workspace` is the owned, tenant-
scoped control surface. Runtime permissions distinguish owner, administrator, researcher,
reviewer, and viewer responsibilities; product actions are protected at the API boundary rather
than only hidden in the interface.

Live-source activation and production readiness still require the named external evidence in
`docs/external-validation-register.md`; code and deterministic fixtures never silently satisfy
those gates.

## Commands

```bash
pnpm dev          # local development
pnpm lint         # ESLint
pnpm typecheck    # generated Next.js types plus TypeScript
pnpm test         # test suite
pnpm check:source-of-truth # canonical documentation check
pnpm build        # production build
pnpm worker       # background worker
pnpm db:generate  # create Drizzle migrations
pnpm db:migrate   # apply Drizzle migrations
bash verify.sh    # complete local verification gate
```

## Container

The included multi-stage Dockerfile builds the standalone Next.js server, includes the pinned research-engine submodule, runs as a non-root user, listens on port 3000, and checks `/healthz`.

```bash
docker build -t market-research .
docker run --rm --env-file .env.local -p 3000:3000 market-research
```

## Continuous integration

`.github/workflows/ci.yml` installs dependencies, lints, type-checks, tests, and builds on pull requests and pushes to `main`.

Deployment infrastructure is intentionally not coupled to a specific hosting platform. Add deployment configuration only after a target environment has been selected.
