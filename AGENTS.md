<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project conventions

- The project name is **Market Research** and the repository is `man-D4wn/Market-research`.
- Read `BLUEPRINT.md` completely before proposing architecture, changing product behavior, or
  adding a connector, ability, Market Twin record type, campaign study, or product surface.
- Use `ROADMAP.md` as the canonical delivery sequence. `product-spec.md` and
  `implementation-plan.md` are compatibility pointers only.
- Preserve the trend-first, people-blind boundary: do not create consumer profiles, cross-platform
  identities, or retained person-level public-source intelligence.
- Keep observations, signals, facts, hypotheses, insights, recommendations, and learnings as
  distinct states. Do not upgrade correlation to causality or call a result Brand Lift unless the
  blueprint's study requirements are met.
- Slack and Rill are legacy integrations, not product dependencies. New work must use the
  provider-neutral source, metric, acquisition, and delivery seams defined in the blueprint.
- Keep infrastructure provider-neutral until a deployment target is explicitly selected.
- The application listens on port 3000 and exposes `GET /healthz` for container health checks.
- Never commit credentials. Read secrets from environment variables and document required variable names in `.env.example`.
- Preserve the pinned `vendor/last30days` submodule; integrate with it through the existing worker boundary rather than patching vendored code.
- Before changing Next.js behavior, read the matching guide in `node_modules/next/dist/docs/`.
- Run lint, type-checks, tests, and a production build before shipping changes that can affect runtime behavior.
