# Implementation plan — Audience Insights Engine

## Metadata

- Initiative ID: `init-20261002-audience-insights-engine`
- Spec: `initiatives/better-craft-audience-insights-engine/product-spec.md` (brief version v5 / spec v2)
- Delivery mode: `internal-backend-tool`
- Reuse decision: `build-new` — no Backstage service, API, or package covers audience-corpus cataloguing, Rill allowlisting, or an admin-config-plus-approval-queue pattern
- Owning team / responsible person: Publishing - Audience / Patrick Johansen (contributor: Martin, Publishing - Product)
- Plan authored at high reasoning effort on 2026-10-08
- Status: `ready-to-execute`, with named credential-dependent exceptions called out per epic (see "Credential-blocked epics" below) — these do not block starting execution at E1.

## Credential-blocked epics (read first)

Every external system this product touches needs its own, not-yet-provisioned credential — none of this session's MCP connectors (used to prove Drive/Slack/Rill are reachable in principle, per the spec) are usable by the deployed app. Rather than block the whole plan, each affected epic is written and coded in full, with its **Gate** carrying a `manual:` note naming exactly what remains to verify live once the credential lands. The executor does not fake a pass on these; it reports the blocked check and stops at that epic's gate, having still completed every other task.

| Epic | Needs | Owner | Requested how |
|---|---|---|---|
| E3 (sign-in) | OneLogin OIDC client ID/secret + discovery URL | IT Helpdesk | T7 sends the request (parallel to the GitHub repo request already sent) |
| E5 (channels) | Slack bot token (`channels:read`, `chat:write`, `files:write`); Google Drive service-account credential (`drive.readonly`; write scope pending separately with IT) | IT Helpdesk / Google Workspace admin | T15/T16 send the requests |
| E6 (runs) | `X_BEARER_TOKEN` or `XAI_API_KEY` for X coverage (Reddit itself is keyless and proves the path without this); optional `SCRAPECREATORS_API_KEY` | Martin | Noted in T19; Reddit-only is sufficient to pass E6's gate |
| E8 (Rill) | Rill service-account token, scoped at Rill's permission layer to `organic_search_performance` and `playbook_event_stream` only | Rill administrator (Martin/Patrick to identify — spec §16) | T24 sends the request once the administrator is named |

GA4 is out of scope for this plan entirely (spec §9 Non-Goals) — the `brand_market.ga4_property_id` column exists (E1) but no GA4 task exists here.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router), one deployable, platform template | Better-craft platform standard for `internal-backend-tool` |
| Database access | Drizzle ORM, migrations as committed SQL | Platform convention (`sql-schema-migrations`) |
| Background jobs | `pg-boss` on the same Postgres database | No new infrastructure; platform default for internal-tool scheduled/background work |
| `last30days` integration | Vendored as a pinned git submodule at `vendor/last30days` (tag pinned, never patched); invoked as a **local subprocess by the worker process, inside the same container image** — not a separate sidecar container, since the platform's CI builds exactly one image per release | devops review required finding; tech review required finding 12 (ADR written in E1) |
| Auth | OneLogin OIDC, Authorization Code + PKCE, session cookie `HttpOnly`/`Secure`/`SameSite=Lax`, roles (`admin`/`viewer`) mapped from the OIDC claim at sign-in | Rule 7 — internal tool, company SSO, no local password store |
| Rill access | Explicit, enumerated measure-and-dimension allowlist (`ALLOWED_RILL_MEASURES`), never `ALL_MEASURES`; word-boundary pattern filter as a second layer; CODEOWNERS-gated; release-blocking CI test + scheduled live-schema drift check | tech review blocking finding 1; compliance review required finding (independently confirmed) |
| UI foundation | Copy `neutral-tokens.css` to `src/styles/tokens.css`; semantic tokens only, no raw colour values in components; mobile-first from 320px, light + dark; every screen built from showroom components only | `ui-design`; spec §12 "Showroom: yes" |
| Table/list component | A single shared `DataTable` showroom component (tabular figures, right-aligned numerics, sticky header) reused by Brand list, Run history, Insight queue, Audit log | Consistency; avoids four bespoke table implementations |
| Combobox (Slack/Drive pickers) | A single shared `AsyncCombobox` showroom component — keyboard-navigable, with loading/empty/error states — used for both the Slack-channel and Drive-folder pickers | UX review required findings 6/FR7a; built once, reused twice |
| Package manager | pnpm (via corepack) | Platform template default |
| File layout | `src/app`, `src/db`, `src/lib`, `src/components`, `src/workers`, `vendor/last30days` (submodule) | Stated once, followed everywhere |
| Naming | Tables `snake_case` plural; components `PascalCase`; every foreign key with an explicit `ON DELETE` | `sql-schema-migrations` |
| Insight drafting LLM | Whatever provider the company's existing LLM tooling already uses (tracked in Rill's `ai_spend_by_employee`) — named and confirmed at T22, not assumed here | Avoids inventing a second LLM vendor relationship |

### Confirmed assumptions (carried from `guided-planning` and the spec)

1. On-demand runs only in v1; no cron/scheduling (pg-boss used for background execution, not recurring schedules).
2. Admin/viewer is the full role model; no per-brand access restriction.
3. Look: agent's choice, clean and neutral — built in E2, confirmed once at the end of E2's checkpoint.
4. Insight review queue is global across brands with a brand filter, not per-brand-only (spec §17).
5. A `cancelled` Run status exists; every Run job has a 10-minute timeout and does not auto-retry.

## Out of scope for this plan

- GA4 integration (spec §9) — schema column only (`brand_market.ga4_property_id`), no client, no task.
- Google Drive **write** delivery — FR9 records routing but does not deliver until IT provisions write access; the delivery code path is written in E5, but is inert (logged, not sent) until that credential exists, exactly as the spec requires. Do not build a workaround.
- Any scheduling/recurring-run UI or worker logic.
- Per-brand access restriction on the `admin`/`viewer` role model.
- Any Rill view or measure outside `ALLOWED_RILL_MEASURES` (E8) — do not add a "just this once" query path.
- A performed, timed Postgres restore test — this is a release-gate item coordinated with `@BetterCollective/devops` (spec §16), not an implementation task; E9 builds the backup *configuration*, not the proof of restore.
- Legal sign-off for Greek-market data processing — a release gate (spec §16), not a task; E6/E8 build Greece like any other market in schema and code, but a feature flag (`market.processing_enabled`, default `false` for Greece) gates it from actually running until Legal signs off (T20).
- Anything not named in a task's file list. No "while I'm here" refactors, renames, or added dependencies.

## Epic map

| Epic | What the user gets | Tasks | Gate |
|---|---|---|---|
| E1 | The two required ADRs exist, and the database schema is real and migrated | T1–T5 | `bash verify.sh` |
| E2 | The admin panel's shared components exist and can be seen at `/showroom` | T6–T9 | `bash verify.sh` |
| E3 | Admins can sign in and see the brand list | T10–T13 | `bash verify.sh` (+ `manual:` OIDC credential note) |
| E4 | Admins can create a brand and edit its research instructions, versioned | T14 | `bash verify.sh` |
| E5 | Admins can connect Slack/Drive channels and map insight types to them | T15–T18 | `bash verify.sh` (+ `manual:` Slack/Drive credential notes) |
| E6 | Admins can trigger a brand's research run and see it complete with real evidence | T19–T21 | `bash verify.sh` |
| E7 | Admins review a global insight queue — accept, edit, discard, retry | T22–T23 | `bash verify.sh` |
| E8 | Rill data (allowlisted only) feeds into evidence, provably never revenue/NDC | T24–T26 | `bash verify.sh` (+ `manual:` Rill token credential note) |
| E9 | Audit trail, retention job, runbook, and release-readiness docs exist | T27–T30 | `bash verify.sh` |
| E10 | Live in production, reachable on VPN | T31–T33 | Platform release steps |

Epics execute in order; within an epic, independent tasks may run together (noted per epic).

## Epics and tasks

### E1 — ADRs and database schema *(no external credential needed)*

- [x] **T1 — Copy the verification harness**
  - Files: `verify.sh` (new, from the plugin's `templates/verify.sh`)
  - Approach: Copy as-is; fill in the project-specific steps as later tasks add them (migration check, build, lint, `helm template`).
  - Acceptance: `bash verify.sh` runs and exits non-zero only because later steps don't exist yet (expected at this point).
  - Check: `bash verify.sh` runs without a shell error.
  - After: —

- [x] **T2 — ADR: Rill allowlist design**
  - Files: `decisions/0001-rill-allowlist.md` (new)
  - Approach: Record the decision from spec §11 — explicit measure-and-dimension allowlist, never `ALL_MEASURES`; word-boundary pattern filter as a second layer; CODEOWNERS gate; the credential itself must be scoped at Rill's permission layer. State the alternatives considered (wildcard + denylist) and why they were rejected (tech review blocking finding 1; compliance review required finding).
  - Acceptance: File exists, follows the repository's ADR format, and is referenced from `product-spec.md` §11 (add one cross-reference line).
  - Check: `test -f decisions/0001-rill-allowlist.md`
  - After: —
  - Closes: tech-reviewer required finding 12 (first of two ADRs)

- [x] **T3 — ADR: `last30days` subprocess architecture**
  - Files: `decisions/0002-last30days-subprocess.md` (new)
  - Approach: Record the decision — vendored, unmodified, pinned git submodule; invoked as a local subprocess of the worker inside the single platform-built image, not a sidecar container (devops review required finding; tech review required finding 12). State why: no plugin/extension seam upstream, platform builds exactly one image per release.
  - Acceptance: File exists, follows the ADR format.
  - Check: `test -f decisions/0002-last30days-subprocess.md`
  - After: —
  - Closes: tech-reviewer required finding 12 (second of two ADRs)

- [x] **T4 — Database schema and first migration**
  - Files: `src/db/schema.ts` (new), `drizzle.config.ts` (new), `drizzle/0001_init.sql` (committed)
  - Approach: Declare every table from spec §11's data model: `brand` (unique `slug`, `updated_by`/`updated_at`), `market`, `brand_market` (incl. `ga4_property_id` nullable), `research_instruction` (unique on `brand_id, market_id, version`), `channel` (unique on `type, external_ref`), `insight_route`, `research_run` (status enum incl. `cancelled`; **partial unique index** on `(brand_id, market_id)` where `status in ('queued','running')`), `evidence` (unique on `run_id, source, external_id`; `sensitivity_flag` nullable), `insight` (`delivery_status` enum), `insight_evidence`, `app_user`, `audit_log`. Every foreign key has an explicit `ON DELETE` (`restrict` for brand/market references, `cascade` for child join rows). Generate SQL with `drizzle-kit generate` and commit it; migrations stay forward-compatible (expand/contract) per devops review required finding.
  - Acceptance: Migration applies to an empty database and creates every table with its stated constraints.
  - Check: `pnpm db:migrate` against a scratch database, then `\d research_run` shows the partial unique index.
  - After: —
  - Closes: tech-reviewer required findings 7, 9, 10, 11 (DB-level duplicate-run guard, evidence uniqueness, `updated_at`/`updated_by`, other uniqueness constraints)

- [x] **T5 — Fill in `verify.sh`'s migration + build steps**
  - Files: `verify.sh` (modified)
  - Approach: Add the migration-check and `pnpm build` steps to the harness so every later epic's gate actually exercises T4's schema.
  - Acceptance: `bash verify.sh` prints `GATE: PASS` against the current (minimal) app.
  - Check: `bash verify.sh`
  - After: T4

**Gate E1:** `bash verify.sh` → `GATE: PASS`.
**Report to the user:** one line — both ADRs exist, schema migrated cleanly.

### E2 — Showroom *(no external credential needed)*

- [x] **T6 — Design tokens**
  - Files: `src/styles/tokens.css` (new, copied from the plugin's `ui-design` neutral tokens asset)
  - Approach: Copy as-is. Semantic tokens only from here on; no component ever references a raw colour value.
  - Acceptance: `src/styles/tokens.css` exists and is imported once, at the app root.
  - Check: `pnpm build` succeeds with the import in place.
  - After: T1

- [x] **T7 — Shared navigation shell and layout primitives**
  - Files: `src/components/AppShell.tsx`, `src/components/PageHeader.tsx` (new)
  - Approach: Left nav (Brands, Channels, Insights, Runs, Settings-as-needed), top bar showing the signed-in user. Mobile-first from 320px; nav collapses to a hamburger below 768px. Light/dark via the token file's media query, no component-level colour overrides.
  - Acceptance: `/showroom` renders the shell with all nav items, at 320px and 1280px, light and dark.
  - Check: `pnpm build`; manual resize check in a browser.
  - After: T6

- [x] **T8 — `DataTable` and `AsyncCombobox` showroom components**
  - Files: `src/components/DataTable.tsx`, `src/components/AsyncCombobox.tsx` (new), `src/app/showroom/page.tsx` (new)
  - Approach: `DataTable` — sticky header, right-aligned numerics, sortable columns, loading/empty/error/success states, keyboard-navigable rows. `AsyncCombobox` — async-searchable list box with its own loading/empty/error states (UX review required finding 6), full keyboard support (arrow keys, Enter to select, Escape to close) and ARIA roles (`combobox`, `listbox`, `option`) — this is the UX review's explicitly flagged highest-risk component for accessibility. Both rendered on `/showroom` with example data covering every state.
  - Acceptance: `/showroom` shows `DataTable` and `AsyncCombobox` in all states (loading, empty, error, populated); keyboard-only navigation reaches and operates both.
  - Check: `pnpm build`; manual keyboard-only walkthrough of `/showroom`.
  - After: T7
  - Closes: UX review required finding 6 (FR7a picker states)

- [x] **T9 — Confirmation dialog and status badge components**
  - Files: `src/components/ConfirmDialog.tsx`, `src/components/StatusBadge.tsx` (new)
  - Approach: `ConfirmDialog` — modal, traps focus, shows a title, body (will carry the "final text + destination channel" content in E7), Confirm/Cancel. `StatusBadge` — semantic-coloured pill for run/insight statuses (`queued`/`running`/`succeeded`/`failed`/`cancelled`/`pending`/`accepted`/`discarded`/`delivery failed`), colour from semantic tokens, never a raw hex value.
  - Acceptance: Both appear on `/showroom` in every named state.
  - Check: `pnpm build`
  - After: T7

**Gate E2:** `bash verify.sh` → `GATE: PASS`; open `/showroom`, confirm every component/state from T6–T9, screenshot.
**Report to the user:** 3 lines + screenshot, then: "Does this look right? (Yes / tell me what to change)" — this is also the one look-confirmation checkpoint (spec §12: agent's choice, neutral).

### E3 — Sign in and see the brand list ← first runnable point

- [ ] **T10 — OneLogin OIDC sign-in**
  - Files: `src/lib/auth.ts`, `src/app/api/auth/[...route]/route.ts` (new), `.env.example` (modified)
  - Approach: Authorization Code + PKCE against the OneLogin discovery URL read from `process.env.ONELOGIN_DISCOVERY_URL`; client ID/secret from `process.env.ONELOGIN_CLIENT_ID`/`ONELOGIN_CLIENT_SECRET` (SSM `remoteRef`, never committed). Session cookie `HttpOnly`, `Secure`, `SameSite=Lax`. Role (`admin`/`viewer`) mapped from the OIDC `groups`/role claim at sign-in and written to `app_user`; unrecognised users default to `viewer`.
  - Acceptance: An unauthenticated request to `/brands` redirects to OneLogin; a completed sign-in lands back on `/brands` with the session cookie set.
  - Check: `pnpm tsc --noEmit`. **Live check deferred** — see Gate note.
  - After: T4
  - Closes: Rule 7 (OneLogin, not Firebase, for an internal tool)

- [ ] **T11 — Role-gated navigation and FR22's render rule**
  - Files: `src/lib/roles.ts` (new), `src/components/AppShell.tsx` (modified)
  - Approach: A `useRole()` hook/server helper; the nav shell and every admin-only control (add brand, edit instructions, connect channel, accept/discard insight) is conditionally **not rendered at all** for a `viewer` — never rendered-then-disabled. `permission-denied` is reserved for a viewer hitting an admin route/API directly.
  - Acceptance: Signed in as a seeded `viewer` user, no admin controls appear anywhere in the UI; a direct `POST` to an admin API route from a viewer session returns 403.
  - Check: `pnpm tsc --noEmit`; one Playwright-free manual check — sign in as each role, confirm the nav.
  - After: T10
  - Closes: UX review required finding 1 (FR22)

- [ ] **T12 — Audit log on every admin write**
  - Files: `src/lib/audit.ts` (new)
  - Approach: One helper, `recordAudit(userId, action, entityType, entityId, before, after)`, called from every mutating API route built from here on (brand, research instruction, channel, insight decision). Append-only; no update/delete path exposed.
  - Acceptance: Creating a brand (T13) inserts one `audit_log` row with the correct `before`/`after`.
  - Check: One integration test or manual DB check after T13's create-brand action.
  - After: T4

- [ ] **T13 — Brand list and create/archive**
  - Files: `src/app/brands/page.tsx`, `src/db/queries/brands.ts` (new)
  - Approach: `DataTable` of brands with a readiness indicator per row ("ready to run" / "not ready — no channel mapped" / "not ready — no research instructions", computed from `research_instruction` and `insight_route` existence). Create-brand form (name, slug, description, markets multi-select from the `market` reference table). Archive/unarchive action, not a delete.
  - Acceptance: `/brands` renders the empty state, then a created brand with a correct readiness reason; archiving removes it from the "ready to run" picker (E6) without deleting history.
  - Check: `pnpm tsc --noEmit`; manual create → verify readiness text → archive → verify it's excluded from the run picker.
  - After: T9, T11, T12
  - Closes: UX review required finding 2 (ready-to-run state); UX review advisory 13 (unarchive action)

**Gate E3:** `bash verify.sh` → `GATE: PASS`; sign-in flow and brand list confirmed on screen (screenshot).
**Manual (deferred until OneLogin credential arrives via T7 of the credential table above):** a real OneLogin sign-in completes end to end. Until then, this gate reports `BLOCKED: OneLogin credential pending (IT Helpdesk)` rather than a false pass.
**Report to the user:** 3 lines + screenshot, checkpoint question.

### E4 — Research instructions, versioned

- [ ] **T14 — Research instructions editor**
  - Files: `src/app/brands/[id]/instructions/page.tsx`, `src/db/queries/research_instructions.ts` (new)
  - Approach: Per-brand form: subreddits, dedicated subreddits, X handle, X related handles, TikTok hashtags, competitors, free-text focus. Per-market row shows an explicit "Inherits brand default" / "Overridden" toggle — never an implicit empty row. Saving creates a new `research_instruction` version; a read-only version-history list shows each past version with its creation date and which Runs used it.
  - Acceptance: Editing and saving creates version 2 while version 1 remains visible in history; a Market left un-overridden shows "Inherits brand default" and a Run for that market uses the brand-level instruction.
  - Check: `pnpm tsc --noEmit`; manual edit → save → confirm version history shows both.
  - After: T13
  - Closes: UX review required finding 5 (FR6a); UX review advisory 9 (version history)

**Gate E4:** `bash verify.sh` → `GATE: PASS`; screenshot of the editor and its version history.
**Report to the user:** 3 lines + screenshot, checkpoint question.

### E5 — Channel management

- [ ] **T15 — Slack channel picker and connection**
  - Files: `src/lib/slack.ts` (new), `src/app/channels/page.tsx` (new), `.env.example` (modified)
  - Approach: `listChannels()` calls Slack's `conversations.list` using `process.env.SLACK_BOT_TOKEN` (SSM). Rendered through the `AsyncCombobox` (T8) — never a typed-in channel ID. Saving creates a `channel` row (`type='slack_channel'`).
  - Acceptance: The picker lists real Slack channels and saves a selection as a `channel` row.
  - Check: `pnpm tsc --noEmit`. **Live check deferred** until `SLACK_BOT_TOKEN` is provisioned (credential table above).
  - After: T8, T11

- [ ] **T16 — Drive folder picker and connection**
  - Files: `src/lib/drive.ts` (new), `src/app/channels/page.tsx` (modified), `.env.example` (modified)
  - Approach: `searchFolders(query)` calls the Google Drive API (`drive.readonly` scope) using a service-account credential from `process.env.GOOGLE_DRIVE_CREDENTIALS_JSON` (SSM). Rendered through `AsyncCombobox`. Saving creates a `channel` row (`type='drive_folder'`); the UI states plainly, next to Drive channels, "Delivery to Drive is recorded but not yet sent — write access is being set up" (FR9) until a write-capable credential exists.
  - Acceptance: The picker lists real Drive folders the service account can see and saves a selection; the "not yet deliverable" notice renders on every Drive channel row.
  - Check: `pnpm tsc --noEmit`. **Live check deferred** until the Drive service-account credential is provisioned.
  - After: T8, T11
  - Closes: UX review required finding 7 (FR9a warning tied to a screen)

- [ ] **T17 — Insight-type routing map**
  - Files: `src/app/channels/page.tsx` (modified), `src/db/queries/insight_routes.ts` (new)
  - Approach: For each `insight_type` (`competitive-intel`, `user-sentiment`, `market-trend`, `brand-mention`, `regulatory-risk`, `other`), a brand-scoped or global mapping to one or more Channels. An unmapped type shows a visible warning on this screen (FR8).
  - Acceptance: Mapping a type to a channel persists; an unmapped type shows the warning; a global default applies when no brand-specific mapping exists.
  - Check: `pnpm tsc --noEmit`; manual map → verify warning disappears for that type.
  - After: T15, T16
  - Closes: UX review required finding 7 (FR8a warning tied to a screen)

- [ ] **T18 — Request Slack and Drive credentials**
  - Files: none (process task)
  - Approach: Send the IT Helpdesk / Google Workspace admin request named in the credential table above, once Martin/Patrick confirm the recipient. Record the sent request's text in `initiatives/better-craft-audience-insights-engine/handoff.md`.
  - Acceptance: `handoff.md` contains the request text and date sent.
  - Check: `test -f initiatives/better-craft-audience-insights-engine/handoff.md`
  - After: T15, T16

**Gate E5:** `bash verify.sh` → `GATE: PASS`; screenshot of channel management with both picker types and the routing map.
**Manual (deferred):** a real Slack channel list and a real Drive folder search, pending T18's credentials.
**Report to the user:** 3 lines + screenshot, checkpoint question.

### E6 — Runs produce real evidence

- [ ] **T19 — Vendor `last30days` and the worker subprocess wrapper**
  - Files: `vendor/last30days` (git submodule, pinned to the current upstream tag), `src/workers/runLast30Days.ts` (new), `.env.example` (modified)
  - Approach: Add the submodule (`git submodule add https://github.com/mvanhorn/last30days-skill vendor/last30days`, pinned). `runLast30Days(instruction)` builds the CLI flags from a `research_instruction` row (`--subreddits`, `--dedicated-subreddits`, `--x-handle`, `--x-related`, `--tiktok-hashtags`, a generated `--plan` tempfile, `--emit=compact`) and spawns it as a child process with a **10-minute timeout**, reading `X_BEARER_TOKEN`/`XAI_API_KEY`/`SCRAPECREATORS_API_KEY` from the environment (SSM) if present — Reddit alone works keyless and is sufficient to prove the path. On timeout, the job is marked `failed` with the error text "last30days subprocess timed out," never silently retried (tech review required finding 9: Run jobs do not auto-retry).
  - Acceptance: Invoking `runLast30Days` with a minimal instruction against **live Reddit** (keyless) returns real post data within the timeout.
  - Check: `pnpm tsx scripts/smoke-last30days.ts` (new smoke script) against the live, keyless Reddit path.
  - After: T4
  - Closes: devops review required finding (single-image subprocess, not sidecar); tech review required finding 8 (explicit timeout), required finding 9 (no auto-retry)

- [ ] **T20 — Run trigger, pg-boss job, and market processing flag**
  - Files: `src/workers/runQueue.ts` (new), `src/app/api/runs/trigger/route.ts` (new), `src/db/schema.ts` (modified: add `market.processing_enabled` boolean, default `true`, explicitly `false` for Greece until Legal signs off per spec §16)
  - Approach: Trigger API enqueues a `pg-boss` job referencing `brand_id`, optional `market_id`, and the current `research_instruction` version; returns immediately with the Run's `queued` status. The worker picks up the job, relies on T4's partial unique index to reject a duplicate concurrent Run for the same brand+market (DB-level, not just a disabled button), drains in-flight jobs on SIGTERM rather than killing them (devops review required finding), and refuses to run a market where `processing_enabled = false`.
  - Acceptance: Triggering a Run returns immediately with `queued`; a second trigger for the same brand+market while the first is `running` is rejected at the database level; a Greece-scoped Run is refused with a clear message until `processing_enabled` is flipped.
  - Check: `pnpm tsc --noEmit`; manual double-trigger test confirms the DB rejects the second.
  - After: T19, T13
  - Closes: tech review required finding 7 (DB-level duplicate-run guard); devops review required finding (worker drain-on-shutdown); compliance review blocking finding (Greece gated by a flag, not silently processed)

- [ ] **T21 — Run history screen and Evidence storage**
  - Files: `src/app/runs/page.tsx`, `src/app/runs/[id]/page.tsx` (new), `src/db/queries/evidence.ts` (new)
  - Approach: Parse `last30days`' compact output into `evidence` rows (unique on `run_id, source, external_id` — a replay is idempotent). Run history list uses `DataTable` with `StatusBadge`; Run detail shows the evidence breakdown by source and any error text. A "Cancel" action on a `queued`/`running` Run, and a stale-run indicator past the 10-minute timeout (tech/UX review advisory).
  - Acceptance: A triggered Run against live Reddit completes `succeeded` with at least one real `evidence` row visible on the Run detail screen.
  - Check: `pnpm tsc --noEmit`; manual trigger → wait → confirm evidence on screen.
  - After: T20

**Gate E6:** `bash verify.sh` → `GATE: PASS`; **live smoke:** trigger a real Run against a seeded brand, quote the actual evidence item that came back, screenshot the Run detail screen.
**Report to the user:** the real evidence quote + screenshot, checkpoint question.

### E7 — Insight review queue

- [ ] **T22 — Insight drafting**
  - Files: `src/workers/draftInsights.ts` (new), `src/db/queries/insights.ts` (new)
  - Approach: After a Run succeeds, compare its Evidence against the trailing baseline (prior Runs for the same brand/market) and draft zero or more `insight` rows (`pending`) via the company's existing LLM tooling (name and vendor confirmed here, not assumed) with a structured-output contract (title, summary, confidence, `shift`/`blip`, linked `evidence_id`s). Evidence text is screened for sensitivity (keyword list) at this step and `evidence.sensitivity_flag` is set; a flagged Insight requires an explicit acknowledgement click before it can be accepted (T23).
  - Acceptance: A succeeded Run from E6 produces at least zero or more well-formed `insight` rows; a deliberately sensitive test string in seed Evidence sets `sensitivity_flag` and is surfaced in T23's UI.
  - Check: `pnpm tsc --noEmit`; manual run against E6's seeded evidence, confirm insight rows and the sensitivity flag path.
  - After: T21
  - Closes: compliance review required finding (sensitivity screening + mandatory acknowledgement before accept)

- [ ] **T23 — Global insight queue: accept, edit, discard, retry**
  - Files: `src/app/insights/page.tsx` (new), `src/app/api/insights/[id]/decision/route.ts` (new)
  - Approach: Queue is global across brands with a brand filter (spec §17 decision), filterable by `pending`/`accepted`/`discarded`/**`delivery failed`**. Accept routes to every Channel mapped to the Insight's type (T17); editing text before accepting opens the `ConfirmDialog` (T9) showing the final text and destination channel(s) before sending (UX review required finding 4). A failed delivery sets `delivery_status='failed'`, shown with its own badge and a retry action, distinct from `accepted`.
  - Acceptance: Accepting an unedited Insight delivers it (to Slack, live, once T18's credential exists — or logs the attempt against a stub transport if not yet available, clearly marked as such in the Run/Insight detail, never presented as delivered); editing then accepting shows the confirmation dialog first; a simulated delivery failure shows the "delivery failed" badge with a working retry.
  - Check: `pnpm tsc --noEmit`; manual accept / edit-accept / forced-failure-retry walkthrough.
  - After: T22, T17
  - Closes: UX review required findings 3, 4 (FR18a delivery-failed state; FR17a confirmation step)

**Gate E7:** `bash verify.sh` → `GATE: PASS`; screenshot of the queue in each filter state.
**Report to the user:** 3 lines + screenshot, checkpoint question.

### E8 — Rill (allowlisted only)

- [ ] **T24 — Request the Rill service-account token**
  - Files: none (process task)
  - Approach: Once Martin/Patrick name the Rill administrator (spec §16 open item), send the request: a read-only token scoped at Rill's permission layer to exactly `organic_search_performance` and `playbook_event_stream`. Record in `handoff.md`.
  - Acceptance: `handoff.md` updated with the request and date.
  - Check: `grep -q "Rill" initiatives/better-craft-audience-insights-engine/handoff.md`
  - After: —

- [ ] **T25 — `ALLOWED_RILL_MEASURES` and the query wrapper**
  - Files: `src/lib/rill.ts` (new), `src/lib/rillAllowlist.ts` (new), `CODEOWNERS` (modified: require a named data-governance approver on `src/lib/rillAllowlist.ts`)
  - Approach: `ALLOWED_RILL_MEASURES` enumerates every measure and dimension name explicitly for `organic_search_performance` and `playbook_event_stream` only — never `ALL_MEASURES`. `queryRill(view, measures)` rejects any view not in the map or any measure/dimension not explicitly named, before issuing the query; a second, word-boundary-matched pattern filter (`revenue`, `ndc`, `commission`, `wagering`, `deposit`, `cost`, `spend`, `ggr`, `ngr`) runs against whatever the allowlist permits, and strips (with an alert, Section 13) rather than silently passes through a match. Every query and every rejection is written to `audit_log`; a change to `rillAllowlist.ts` itself is also audit-logged via the CODEOWNERS-gated PR process, not at runtime.
  - Acceptance: Querying an allowed measure succeeds; querying `commercial_revenue` (or any non-allowed view) is rejected before any network call to Rill; a synthetic measure name containing `revenue` on an allowed view is stripped from the result, not returned.
  - Check: unit test suite covering (a) every currently-known measure/dimension on both allowed views, (b) a rejected view, (c) a stripped-measure case.
  - After: T4
  - Closes: tech review blocking finding 1 (explicit measure-level allowlist); tech review required finding 2 (dimension names checked too); tech review required finding 5 (word-boundary matching); compliance review required finding (CODEOWNERS gate, audit logging)

- [ ] **T26 — Rill evidence source and CI/schema-drift gate**
  - Files: `src/workers/pullRillEvidence.ts` (new), `.github/workflows/rill-schema-check.yml` (new)
  - Approach: Pulls allowlisted Rill data into `evidence` rows (`source='rill'`) as part of a Run (T20). The CI workflow runs T25's unit test suite as a **release-blocking** check on every PR, plus a separate scheduled job that re-queries Rill's live schema for the two allowed views and **alerts** (not just logs) if an unrecognised measure/dimension appears — catching drift between deploys, not only at CI time.
  - Acceptance: A Rill-sourced evidence row appears on a Run's detail screen (once T24's credential exists) containing only allowlisted fields; the CI check fails the build if `rillAllowlist.ts` is edited without updating the matching unit-test fixture.
  - Check: `pnpm test src/lib/rillAllowlist.test.ts`. **Live check deferred** until T24's credential arrives.
  - After: T25, T21
  - Closes: tech review required finding 4 / devops review required finding 16 (named, release-blocking CI gate + live-schema drift check)

**Gate E8:** `bash verify.sh` → `GATE: PASS`; the unit-test suite's output pasted into the report as proof of the allowlist's behaviour.
**Manual (deferred):** a live Rill query against the production token, pending T24.
**Report to the user:** 3 lines + the test output, checkpoint question.

### E9 — Audit, retention, and release-readiness documentation

- [ ] **T27 — Retention/purge job (built, shipped disabled)**
  - Files: `src/workers/purgeEvidence.ts` (new)
  - Approach: A parameterized `pg-boss` job that deletes/anonymizes `evidence` rows older than a configurable ceiling, keyed on `retrieved_at`. Ships with no default ceiling and is **disabled** until Legal sets one (spec §10/§16) — this is deliberate, not an oversight; do not invent a default retention period.
  - Acceptance: Running the job manually with an explicit test ceiling removes exactly the rows older than that ceiling and no others; with no ceiling configured, the job is a no-op and logs that it is disabled.
  - Check: One test run against seeded evidence with a test ceiling, confirming row counts before/after.
  - After: T21
  - Closes: compliance review required finding (retention/purge mechanism built now, ceiling pending Legal)

- [ ] **T28 — Data-subject-rights procedure (documentation)**
  - Files: `docs/dsr-procedure.md` (new)
  - Approach: Document the erasure/objection path: how to locate and purge a given handle's `evidence` rows on request, and the explicit residual-risk disclosure (an already-delivered Slack message or Drive file cannot be retracted) that Legal must accept before launch.
  - Acceptance: File exists and names the exact query/admin action used to fulfill a request.
  - Check: `test -f docs/dsr-procedure.md`
  - After: T21
  - Closes: compliance review required finding (DSR procedure documented)

- [ ] **T29 — Observability wiring and SLO instrumentation**
  - Files: `src/lib/metrics.ts` (new)
  - Approach: Counters for Run success/failure and duration, per-source Evidence counts, Rill-allowlist rejections and stripped-measure events, Slack/Drive delivery failures; emitted as structured JSON log lines (platform-standard log collection) and as counters for the platform's standard metrics-scrape convention, confirmed against actual platform tooling at this task's implementation time rather than assumed in the spec. Alert thresholds: worker queue depth **and** oldest-waiting-job age; any Rill-allowlist rejection or stripped measure; repeated Run failures for one brand. Instrument the two SLOs (10-minute Run completion, 30-second delivery latency) as timers.
  - Acceptance: Triggering a Run (E6) and an Insight delivery (E7) each produce the named structured log lines/counters.
  - Check: Manual grep of worker logs after a test Run and a test delivery.
  - After: T20, T23
  - Closes: devops review required findings (named observability destination, SLOs, expanded alerting)

- [ ] **T30 — Runbook**
  - Files: `docs/runbook.md` (new)
  - Approach: Beyond the platform's standard rollback runbook: procedures for a stuck/long-running Run, a Rill-allowlist-rejection spike, a worker crash mid-Run, and a Slack/Drive delivery failure beyond the in-UI retry. Also records: the Postgres backup/restore item as an explicit open release gate owned by `@BetterCollective/devops` (not resolved by this plan), and the Greece/Legal gate as an explicit open release gate.
  - Acceptance: File exists and covers all four named scenarios plus both release gates.
  - Check: `test -f docs/runbook.md`
  - After: T26, T23
  - Closes: devops review required finding (product-specific runbook)

**Gate E9:** `bash verify.sh` → `GATE: PASS`.
**Report to the user:** 3 lines, checkpoint question.

### E10 — Release

- [x] **T31 — Repository gate and move-in**
  - Files: none (process task, per `better-craft-platform`)
  - Approach: Once BC Helpdesk confirms `BetterCollective/better-craft-audience-insights-engine` exists and accepts a push, run the platform script's `clone`/`rename` steps, move this plan and the spec to the new repo's root, and continue execution there.
  - Acceptance: `better_craft_platform.py status --repo better-craft-audience-insights-engine` reports the repository exists and is template-derived.
  - Check: the status command above.
  - After: all prior epics complete (or as many as credentials allow — see below)

- [ ] **T32 — Local container smoke test**
  - Files: none
  - Approach: Build the image locally, run it, confirm `GET /healthz` returns 2xx and the sign-in → brand list → trigger-run → review-queue path works against a local Postgres.
  - Acceptance: All of the above pass locally.
  - Check: `docker build` + `docker run` + `curl localhost:3000/healthz`.
  - After: T31

- [ ] **T33 — Pull request, code-owner review, merge**
  - Files: none
  - Approach: Open the PR to `main`; `@BetterCollective/devops` reviews `k8s/`/`.github/` changes (the Dockerfile's Python runtime addition, the CI workflow from T26); confirm the Postgres backup/restore item (spec §16) and the Greece processing-flag default are both visible in the PR description as open release items, not silently resolved. One explicit "Yes" from the user before merge.
  - Acceptance: PR merged; ArgoCD reconciles; `/healthz` responds at the live URL.
  - Check: `curl https://audience-insights-engine.better-craft.bettercollective.dev/healthz` (VPN/office network).
  - After: T32

**Release note (not a gate, a standing fact):** this release ships with Greek-market processing disabled by flag (T20) and with Postgres backup/restore unperformed (spec §16) — both are named, owned open items, not defects introduced by this plan skipping a step.

## Dependency graph

```text
E1(T1▶T2,T3▶T4▶T5) ──▶ E2(T6▶T7▶{T8,T9}) ──▶ E3(T10▶T11▶T12,T13) ──▶ E4(T14)
                                                                         │
E4 ──▶ E5({T15,T16}▶T17, T18 parallel) ──▶ E6(T19▶T20▶T21) ──▶ E7(T22▶T23)
                                                                         │
E6/E4 ──▶ E8({T24,T25}▶T26) ──▶ E9({T27,T28,T29,T30}) ──▶ E10(T31▶T32▶T33)
```

Independent groups: {T2, T3} in E1; {T8, T9} in E2; {T15, T16} and T18 in E5; {T24, T25} in E8; {T27, T28, T29, T30} in E9.

## Integration rule (non-negotiable)

For Slack (T15), Drive (T16), `last30days`'s own sources (T19), and Rill (T25/T26): the plan names the exact client call, the exact environment variable the credential is read from, and the owner who must provision it (credential table, above). The acceptance criterion is the **live** call wherever the credential already exists in this environment (Reddit, keyless, in T19); where it does not yet exist (OneLogin, Slack, Drive, Rill), the task is built and type-checked in full, and the corresponding epic's **Gate** reports a named `manual:` deferral rather than a false pass. No mock or fixture ever satisfies an integration task's acceptance criterion.

## Progress log

One line per completed task, appended by the executor.

```text
[E1 · 2/33] T2 — ADR 0001 (Rill allowlist) written: decisions/0001-rill-allowlist.md
[E1 · 2/33] T3 — ADR 0002 (last30days subprocess) written: decisions/0002-last30days-subprocess.md
[E10 · 3/33] T31 — Repository gate passed: BetterCollective/better-craft-audience-insights-engine exists, template-derived, pushable. Cloned to /Users/mam/Documents/Projects/audience-insights-engine, chart renamed, spec/plan/ADRs moved to repo root and pushed to branch bettercraft/audience-insights-engine (commit 5e90d8c).
[E10 · 3/33] ECR terraform-bc entry requested: github.com/BetterCollective/better-craft-audience-insights-engine/issues/1 (blocks first image push, not the code).
[E1 · 4/33] T4 — Database schema is real: all 12 tables from spec §11 exist, migrated cleanly to an empty Postgres, with the partial unique index preventing two concurrent runs for the same brand+market confirmed live.
[E1 · 5/33] T5 — Verification harness now checks migrations and builds the app in one command (`bash verify.sh` → `GATE: PASS`); note: T1 (copying `verify.sh` from the template) had not actually been done despite being marked otherwise, so this task also performed that copy as a prerequisite.
[E2 · 6/33] T6 — Semantic design tokens (light + dark) now live in `src/styles/tokens.css` and are the app's single source of colour; the plugin's `neutral-tokens.css` asset wasn't reachable in this environment, so the set was authored from scratch per spec §12, keeping the existing Better Collective brand palette and extending it with button/status/nav tokens.
[E2 · 7/33] T7 — The admin panel now has a shared navigation shell (Brands/Channels/Insights/Runs, placeholder signed-in user) that collapses to a hamburger below 768px and themes via tokens only.
[E2 · 8/33] T8 — `/showroom` shows the shared `DataTable` (sticky header, sortable numeric column, keyboard-navigable rows) and `AsyncCombobox` (full ARIA combobox/listbox/option pattern, arrow/Enter/Escape keyboard support) in every state — loading, empty, error, success.
[E2 · 9/33] T9 — `/showroom` also shows a focus-trapping `ConfirmDialog` (default and destructive variants) and a `StatusBadge` pill for every named run/insight status.
```

## Verification summary

- `pnpm build` exits zero.
- `pnpm db:migrate` applies cleanly to an empty database.
- Manual click-path: sign in → brand list → create brand → edit research instructions → connect a Slack channel → map an insight type → trigger a run → see evidence → review and accept an insight → see it marked delivered (or clearly marked deferred if Slack's credential isn't live yet).
- Every acceptance criterion above has been observed at least once, or named as deferred with its owner.

## Required expert findings folded in

| Finding | Severity | Task |
|---|---|---|
| Rill `ALL_MEASURES` + denylist is not an allowlist at the measure level | blocking (tech) / required (compliance) | T25 |
| Rill filter must check dimensions, not just measures | required (tech) | T25 |
| Rill service-account token must be scoped at Rill's own permission layer | required (tech) | T24 |
| Allowlist test must be a named, release-blocking CI gate + live-schema drift check | required (tech, devops) | T26 |
| Substring pattern filter needs word-boundary matching | advisory (tech) | T25 |
| DB-level guard against duplicate concurrent Runs | required (tech, devops) | T4, T20 |
| Explicit Run job timeout | required (tech) | T19 |
| No Run auto-retry; `evidence` uniqueness for idempotency | required (tech) | T4, T19 |
| Two ADRs (Rill allowlist, `last30days` subprocess) before the code is built | required (tech) | T2, T3 |
| `last30days` must run as a worker subprocess in one image, not a sidecar | required (devops) | T19 |
| Worker drain-on-shutdown | required (devops) | T20 |
| Named observability destination, SLOs, expanded alerting | required (devops) | T29 |
| Product-specific runbook | required (devops) | T30 |
| Postgres backup/restore undefined | blocking (devops), release gate | T30 (documented), spec §16 (resolved) |
| Viewer must never see rendered admin controls | required (UX) | T11 |
| Ready-to-run / not-ready state | required (UX) | T13 |
| Delivery-failed insight state + retry | required (UX) | T23 |
| Confirmation step before an edit-then-accept send | required (UX) | T23 |
| Per-market inherit/override indicator | required (UX) | T14 |
| Slack/Drive picker loading/empty/error states | required (UX) | T8 |
| Unmapped-type and inert-Drive warnings tied to a screen | required (UX) | T16, T17 |
| Lawful basis / Legitimate Interest Assessment | required (compliance) | spec §16 (owner: Legal), referenced in T28 |
| Sensitivity-screening flag + acknowledgement gate | required (compliance) | T22, T23 |
| Retention/purge job built now, disabled until Legal sets a ceiling | required (compliance) | T27 |
| DSR procedure documented | required (compliance) | T28 |
| LLM vendor named, DPA/SCC confirmed | required (compliance) | T22 (vendor named at implementation time) |
| Greece/EU launch needs Legal sign-off | blocking (compliance), release gate | T20 (flagged), spec §16 (resolved) |

## Plan changes

- 2026-10-08 — **T31 (repository gate) must run before resuming any code-writing task, not at the end as originally sequenced in E10.** The `better-craft-platform` rule is explicit: no product code is written until `BetterCollective/better-craft-audience-insights-engine` exists and has been cloned into. T2/T3 (documentation, not code) were completed locally while waiting, per the plan's own distinction between docs and code. Treat T31 as logically preceding T4, not following T30, even though it is numbered within E10 below for readability of the release epic as a whole.
- 2026-10-08 — **T31 executed.** `gh` was missing locally; rather than wait on BC Helpdesk for a local tool install, the agent installed it via `brew install gh` and ran the device-code web auth flow with the user (code entered by the user at github.com/login/device). The repository existed already (created from the template, confirmed `can_push: true`). Cloned, chart renamed, planning docs moved to the repo root, BetterCraft activated there (`platform: better-craft-eks`, `layout: single-app` confirmed), ECR handoff opened as issue #1. Execution resumes at T4.

## Discovered during execution

- T1 was marked complete in an earlier dispatch's instructions but `verify.sh` did not actually exist at the repo root. The T4/T5 executor discovered this and copied the template as part of T5's work. Reconciled: T1 ticked here; no separate action needed.
- `research_instruction`'s unique constraint on `(brand_id, market_id, version)` does not catch a duplicate version for a brand-level instruction (`market_id IS NULL`), since standard SQL treats `NULL` as distinct from `NULL` in a unique constraint. Low risk given this table's low write concurrency (a handful of admins), but worth a `NULLS NOT DISTINCT` constraint (Postgres 15+) or application-level locking on save, as a follow-up — not in the current plan, not acted on now.
- `app_user` has no unique constraint on `sso_subject_id` or `email`. Worth adding before relying on either as a natural key for lookups — not in the current plan, not acted on now.
- T6/T8/T13's file paths say `src/app/...`, but the template this repo was cloned from (T1-T5, pre-dating this plan's app-router pages) already put Next's app router at the repo root (`app/`), not under `src/`. Next.js does not support both `app/` and `src/app/` at once. E2 (T8) built `app/showroom/page.tsx` at the established root location instead; `src/db`, `src/lib`, `src/components` stay under `src/` exactly as the plan says. Future tasks referencing `src/app/...` should read it as `app/...`.

## Open questions

Carried from spec §16, none of which block starting execution:

- Where is "target audience" written down today? — owner: Patrick/Martin.
- Who receives output in v1, and how many? — owner: Patrick.
- Precise acceptance test for the first US + Greece report — owner: Patrick/Martin.
- Should Insight summaries be English-only or localised per market? — owner: Patrick/Martin (T22 ships English-only pending this answer, per spec §17's open assumption).
- Can a recurring micro-survey start in week one? — owner: Patrick.
- Where does sports data live, and is it relevant? — owner: Patrick.
- Media rights tracking — owner: Patrick.
- GA4 administrator and per-brand/market credential issuance process — owner: Martin.
- **Release gates (not implementation gates):** Greece/EU Legal sign-off; Postgres backup/restore definition and performed test — both owned per spec §16 and named again in T30/T33.
