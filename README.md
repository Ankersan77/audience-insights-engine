# Market Research

Market Research is an internal audience-insights application for managing brands, research instructions, evidence, research runs, insights, and delivery channels.

## Stack

- Next.js 16 and React 19
- PostgreSQL with Drizzle ORM
- `pg-boss` background jobs
- OneLogin OIDC authentication
- Optional Slack, Google Drive, and Rill integrations
- The pinned `last30days` research engine in `vendor/last30days`

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

## Environment variables

Required and optional variables are documented in `.env.example`. Keep real values in local or hosted secret storage; never commit them.

The minimum application setup requires:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ONELOGIN_DISCOVERY_URL`
- `ONELOGIN_CLIENT_ID`
- `ONELOGIN_CLIENT_SECRET`

Slack, Google Drive, Rill, and evidence-retention variables are optional until those integrations are enabled.

## Commands

```bash
pnpm dev          # local development
pnpm lint         # ESLint
pnpm typecheck    # generated Next.js types plus TypeScript
pnpm test         # test suite
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

`.github/workflows/rill-schema-check.yml` separately protects the Rill allowlist and performs the scheduled live-schema check once `RILL_API_TOKEN` is configured.

Deployment infrastructure is intentionally not coupled to a specific hosting platform. Add deployment configuration only after a target environment has been selected.
