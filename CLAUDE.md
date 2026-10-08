# Project instructions — BetterCraft governance

<!-- bettercraft-rules-version: 6 -->

<!--
  Installed from the BetterCraft Claude Code plugin.
  Installed on activation by /better-craft (scripts/activate_bettercraft.py).
  These rules must live in the repository, because a plugin cannot ship always-on instructions.
  Keep them in sync with ${CLAUDE_PLUGIN_ROOT}/references/operating-rules.md when the plugin updates.
  Add your own project-specific instructions BELOW the rules, not inside them.
-->

This repository uses the **BetterCraft** plugin for governed, agent-assisted product delivery.
`governed-build-flow` is the single front door for any new build request.

## Where things live

- Product initiatives: `initiatives/<project-folder>/` — never at the repository root.
- **Except in a better-craft platform repository** (`platform: better-craft-eks` in
  `.bettercraft/activation.json`): it holds exactly one product, at its root, and
  `initiatives/<project-folder>/` means the repository root everywhere in these rules and skills.
- The canonical spec for each initiative: `initiatives/<project-folder>/product-spec.md`.
- Skills, expert subagents, hooks, governance references: provided by the plugin.

## Validation

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/validate_plugin.py"
```

---

## Rule 1 — Language policy (always applies)

Users may prompt in any language. **Every persisted artifact must be written in English**: code,
comments, Markdown, ADRs, RFCs, tickets, catalog entries, Slack announcements, commit messages, PR
descriptions, and documentation. Translate and normalize non-English requirements into English
before creating or modifying any persisted artifact. A commit hook enforces this on staged text.

## Rule 2 — Two stores of truth (Backstage catalog + Initiatives API)

- **Backstage** is the catalog of platform capabilities: internal/external **services & APIs** plus a
  **registry of reusable packages** (e.g. `@company/widget-kit`). Every entry carries a documentation
  link so an agent knows how to use it. Discover them **only** through the `company-context` MCP tools
  (`search_services`, `search_apis`, `search_packages`, `get_service`, `get_api`, `get_package`,
  `get_api_usage_guide`, `fetch_api_documentation`, `fetch_package_documentation`).
- **Initiatives API** is the source of truth for **initiative records** (portfolio). Read/write them
  **only** through MCP (`check_duplicates`, `list_initiatives`, `get_initiative`,
  `register_project_initiative`, `update_initiative_status`, `update_project_brief`, `log_build_cost`,
  `request_expert_review`, `record_review_result`, `add_initiative_screenshot`,
  `list_initiative_screenshots`, `delete_initiative_screenshot`). Initiatives are **not** stored in
  Backstage. An initiative's dashboard-facing fields are a short `summary` (max 280 characters) plus
  up to 4 `highlights` and up to 3 screenshots; the canonical full specification stays in
  `initiatives/<folder>/product-spec.md`.
- Do not invent service capabilities, API endpoints, owners, or policies.
- **Every product initiative's source lives in its own folder under `initiatives/`** (e.g.
  `initiatives/<project-folder>/`). Never create project source at the repo root — the root is
  reserved for the repository's own infrastructure. The one exception is a better-craft platform
  repository, which is one product at its root (`better-craft-platform`).
- An initiative is registered **early** (even during exploration) and advances through a **single
  status that names the stage**: `exploring → planning → in-review → approved → building → deployed →
  done` (plus `blocked`, `cancelled`).
- External platforms (Firebase, third-party APIs) are represented as Backstage entities.
- **Never invent a team or owner.** Collect the owning team and responsible person from the user via
  `initiative-ownership`; team names are canonical in `catalog/teams.json` and resolved with fuzzy
  matching (a near-match like "Affiliate" prompts "did you mean Technology - Affiliate Services?").
- See `catalog/CONVENTIONS.md` for both contracts (initiative record fields + Backstage annotations).

## Rule 3 — Planning gate (enforced)

Implementation must not start until ALL of these are true:

1. `check_duplicates` was run and matches were shown to the user.
2. Discovery ran (`guided-planning`) **to completion** — its readiness test printed `Unknown: 0`,
   every assumption was confirmed by the user, and every deferred item has a named owner that
   nothing in the build depends on. Discovery ends when the build is fully specified, not when the
   baseline question list runs out.
3. `initiatives/<project-folder>/product-spec.md` exists (`spec-authoring`) — what is being built.
4. `initiatives/<project-folder>/implementation-plan.md` exists (`implementation-plan`) — how, in
   what order, with an acceptance criterion and a verification step per task, no unresolved
   decisions, and a task for every `required` expert finding.
5. The user approved the scope (Phase 2) and the execution plan (Phase 5c).
6. The initiative is registered in the Initiatives API (early registration in Phase 1).
7. Required expert reviews for the detected risk triggers are requested (see Rule 5).

A `PreToolUse` hook blocks writes to product source under `initiatives/<project-folder>/` when
that folder's `product-spec.md` or its `implementation-plan.md` is missing. In a platform repository
the whole tree is the project — `k8s/` and `.github/` included — and only `.bettercraft/`,
`.claude/` and `catalog/` are exempt. This is enforcement,
not a reminder.

The gate is defined by exclusion: everything under the project folder is product source **except**
documentation (`.md`, `.txt`), lockfiles, `catalog-info.yaml`, and build output (`dist/`, `build/`,
`node_modules/`, `screenshots/`). A root-level `index.html`, `main.js`, `package.json`, or
`vite.config.ts` is gated like anything else. Everything else in the flow — the duplicate check, the
expert reviews, the release gate — is **agent-attested, not hook-enforced**: the existence of the
two planning files is the only condition a hook actually verifies (not their quality, and not
whether the readiness test really reached `Unknown: 0`). Treat the other blocking conditions as
process discipline, and do not describe them to users as if a hook guaranteed them.

## Rule 4 — Planning vs implementation

Planning and implementation are two different activities, at two different reasoning efforts,
producing two different artifacts. Blurring them is what makes a build wander. The procedure is in
`governed-build-flow`; what binds always is this:

- **Discover first**, in plan mode at higher reasoning effort (`guided-planning`), and do not edit
  source while doing it. Discovery ends when every fact needed to implement is resolved, not when a
  question list runs out. Anything only the user knows is asked; anything technical is decided by
  the agent and stated in plain English; anything with a safe default is assumed and confirmed in
  one batch.
- **Then `product-spec.md`** (`spec-authoring`) — what is being built and why.
- **Then `implementation-plan.md`** (`implementation-plan`), after the reuse decision and the expert
  findings — epics a user would recognise, each task naming its files, acceptance criterion and
  cheap `Check`, each epic one expensive `Gate`. A plan containing "decide whether to", "consider",
  or `TBD` is not finished. Where the build consumes an external system, the first epic proves the
  live data path with the real credential; a mock never satisfies an integration criterion, and a
  missing credential is reported, not stubbed around.
- **Implement** only once both artifacts exist and the user approved the execution plan.
  Implementation is **execution, not design**, so it runs on a cheaper model — dispatch
  `plan-executor`, one dispatch per epic. Verify cheaply per task, expensively once per epic. Tick
  each checkbox as its `Check` passes: that file is the progress record.
- **When reality contradicts the plan, stop and replan** rather than improvising past it, recording
  why under the plan's `Plan changes`. If the *product* changed, `product-spec.md` changes first —
  the spec stays the source of truth for what the product is, the plan only for how it is built.
- After implementation, `build-cost-logging` records the **estimated** token/cost figure.

## Rule 5 — Expert roles and orchestration

`governed-build-flow` is the single front door. It classifies risk triggers and **dispatches expert
subagents in parallel** (via the Task tool) for every triggered domain. The subagents live in
the plugin and are dispatched by name:

| Subagent | Owns | Triggered by |
|---|---|---|
| `tech-reviewer` | architecture, framework selection, API design, service reuse; internal access control, relational data, background work, complexity budget | always |
| `ux-reviewer` | product flow, usability, accessibility, design-system; technical SEO for public pages; operational-UI conventions for admin panels | any customer-facing UI or public web page, and any internal admin surface |
| `compliance-legal-reviewer` | data classification, privacy, marketing consent, promotion/prize legality, fraud/abuse, jurisdiction scoping | personal data, profiling, analytics, retention, marketing use, contests, prizes, voting, rewards, target markets, age-gating, gambling adjacency |
| `devops-reviewer` | deployment, observability, traffic/capacity; database backup/restore and worker operations | production launch, high traffic, a service that owns a database or runs background work |

The compliance lenses overlap by design. The data inventory is built **once**, each finding is
reported by its owning lens only, and where two lenses reach the same control the **higher severity
wins**. Never restate one issue under several lenses.

Each subagent uses the matching BetterCraft skill(s) and returns findings with severity
`advisory` / `required` / `blocking`. Blocking authority is defined in
`references/expert-governance.md`. Advisory market/competitor context is available on demand via the
`digital-intelligence-market-scan` skill (invoked directly, not as a standing subagent).

## Rule 6 — Non-technical communication (autopilot)

The people this kit serves describe outcomes, not requirements. `bettercraft-autopilot` is the
communication and decision contract, loaded by `/better-craft` and in force for the whole build.
Its three rules:

- **Decide by default.** Every technical choice — delivery mode, framework, hosting, packaging,
  storage, auth path, proxy-or-direct, state management, libraries, file layout, migration and
  queue tooling — is the agent's, taken from the radar and the delivery mode. A technical question
  put to a non-technical user is a defect. State the outcome in one plain sentence only when it
  changes what the user gets. **Ask everything the user alone can answer before scope approval**,
  batched up to four per message, including where files like this get published when no host is
  recorded yet — a question asked mid-build costs 20-70 minutes of dead time. At most **one**
  question after scope approval; ownership, scope boundaries, personal data and target markets are
  the four things that are always asked or deferred with a named owner, never quietly assumed.
- **Say less.** Five lines is a normal reply, twelve at the scope approval. Up to four questions in
  one message before scope approval, one at a time after it. Never print a skill name, agent name, phase number, MCP tool name, severity label,
  readiness-test table, raw expert finding, or stack trace. Never ask anyone to paste a secret,
  token, key, or password into the chat.
- **Report progress, not activity.** After each completed epic, send the line produced by
  `${CLAUDE_PLUGIN_ROOT}/scripts/plan_progress.py` — for example
  `67% done (8/12) · finished: results table · next: login screen` — and nothing else. Users hear
  epics ("login screen"), never tasks.

Autopilot governs what is **said**, never what is **checked**. Every gate in Rule 3 still holds:
being brief is not the same as being permissive.

## Rule 7 — Identity and data defaults

**Customer-facing products use Firebase. Internal tools use company SSO and PostgreSQL.** These are
two different paths, and applying the wrong one is a review finding in both directions.

### Customer-facing products

- Use **Firebase Authentication** for end-user auth (signup, login, session identity, token
  verification) and **Firebase Firestore** for application-owned user data (profiles, participant
  records, prediction entries, campaign state). Treat the Firebase UID as the primary subject id.
- **Real-time shared state is a documented exception to the Firestore default.** Do not use Firestore
  as the primary store for high-frequency real-time game/live state (per-tick writes: latency and
  cost). Choose the store via `realtime-architecture`: **Firebase Realtime Database** for lightweight
  shared/presence state, or a **dedicated authoritative server** (in-memory + fixed-tick loop) for
  competitive or reward-bearing gameplay. Firestore still owns the durable records (profiles,
  results, consent). Firebase Auth remains the identity path in all cases.
- Do not recommend custom auth, custom session, custom password stores, or non-Firebase user-data
  stores without a documented, approved exception (`references/approved-technology-radar.md`).
- Provide Firestore Security Rules before any preview that writes user data. Invoke
  `firebase-auth-user-data` when Firebase is recommended (it also carries the IT-helpdesk
  provisioning checklist); point users to `references/firebase-it-helpdesk.md`.

### Internal tools

- Employees sign in with their **company account over OIDC against OneLogin** (Authorization Code +
  PKCE). Do not use Firebase Auth for staff identity, and do not build a local password store. This
  is the approved path, not an exception — connecting to the company identity provider is the
  opposite of a custom authentication service. Invoke `internal-auth`; the IT request
  checklist is in references/onelogin-it-helpdesk.md.
- Authorisation is owned by the tool: **roles map to permissions, and code checks permissions**, so
  adding a role later is a mapping change and not a refactor. `admin` and `user` are the starting
  pair. Enforce on the server, scope checks to the record, and audit admin actions. Invoke
  `internal-auth`.
- **PostgreSQL** is the store for an internal tool's own operational data, accessed through Drizzle
  ORM with reviewed SQL migrations applied as an explicit deploy step. Invoke
  `sql-schema-migrations`. Firestore is not the default here — that default is about end-user data
  on customer-facing products. On the better-craft platform it runs in-cluster, as the chart's
  StatefulSet dependency, never on RDS (`better-craft-platform`).
- Scheduled and queued work uses **pg-boss** on the same database before any broker is considered.
  Invoke `background-jobs-scheduling`.
- Internal admin surfaces get a showroom first and follow the token contract (`ui-design`). No SEO,
  no marketing consent — but the same accessibility bar.

## Rule 8 — Keep the architecture as small as the problem

Every build that adds a deployable, a datastore, or an infrastructure component runs
`tech-architecture-review`, which returns `simple`, `justified-complex`, or `over-engineered`.
Justified complexity is allowed and must be recorded — the reason, the named owner, an ADR, and a
radar exception where the component is not on the radar. A new production component with **no named
owner** is blocking. State the trade-off to non-technical users in plain English: what was added,
what it costs to run, and what the simpler version would give up.


## Rule 9 — Design is the agent's call, on one token system

The look is decided by the agent, not approved in a separate phase. The detail is in `ui-design`;
what binds always is this:

- **Ask once, then decide.** Discovery asks one question: any preference for how it should look —
  an example site or screenshot, colours, a brand to match? With an answer, the agent takes the
  cues; without one, it picks a clean, neutral look itself. No sketches for approval, no design
  options, no design vocabulary in replies. The UI is shown as screenshots at the epic checkpoints,
  and once, when the build works and before it goes live, the user is asked whether anything about
  the look should change. The recorded answer is `Look:` in `product-spec.md` section 12.
- **One token contract, named like the company website.** Component code uses semantic tokens
  (`--surface-background`, `--text-headings`, `--button-primary`, …), never raw colours. The names
  match the website's design system so its brand stylesheet drops in unchanged; the default values
  are neutral. A web component reads the host page's tokens with a neutral fallback and never
  re-declares them inside its shadow root, so on a real page it takes the site's colours, and its
  dark mode, automatically.
- **Mobile first, working at every width** — from 320 px to a wide desktop, in light and dark, at
  the accessibility floor (contrast checked by script, visible focus, labels, keyboard path).
- **Larger apps get a showroom first.** An admin panel, an internal tool, or any app with three or
  more screens or a shared navigation shell builds a showroom of every shared component as its
  first UI epic, and every screen is assembled from showroom components only. A web component, a
  single screen or a landing page does not need one. The agent decides which and records
  `Showroom:` in the spec; the showroom is not a user approval.

## Rule 10 — Shipping is part of building

A build that only runs locally is not finished. `devops-readiness` decides whether a
release may happen; `guided-deployment` performs it — host resolution, environment-variable plan,
preview, smoke tests, one explicit production approval, release, rollback plan, handover.

**Everything that runs a server process ships to the better-craft platform** — its own
repository, `BetterCollective/better-craft-<slug>`, created from the better-craft app template,
built by GitHub Actions and deployed by ArgoCD to the shared EKS namespace. Merging to `main` is
the deploy. `better-craft-platform` is the procedure. Jarvis (`@JarvisBC-AI`) and
`@BetterCollective/devops` are code owners of `k8s/` and `.github/` and review every change there;
the platform facts they maintain win over anything the agent assumes.

Other artifact classes — a public static page, which cannot load from the office/VPN-only
platform — resolve their host from the deployment target registry
(`${CLAUDE_PLUGIN_ROOT}/catalog/deployment-targets.json`, overridable per repository or with `$BETTERCRAFT_DEPLOYMENT_TARGETS`). Where the registry
has none, it is asked **once** per organisation and recorded with `${CLAUDE_PLUGIN_ROOT}/scripts/resolve_deploy_target.py --set`; no later build
asks again. Never invent a host: where nothing is recorded and nobody can name one, stop at a
verified preview and raise it as an open item with a named owner.

Secret *values* never appear in the chat, in the repository, or in the browser bundle. Secret
names, owners and locations are recorded; the values are entered in the host's own interface —
on the platform, by a person with AWS SSO, into SSM Parameter Store.

## Rule 11 — Activation

Installing the plugin does nothing to a repository on its own. `/better-craft` activates it:
`${CLAUDE_PLUGIN_ROOT}/scripts/activate_bettercraft.py` installs these rules into the repository's
`CLAUDE.md` (creating it, or appending below existing content) and writes
`.bettercraft/activation.json`. The planning-gate hook stays inert in a repository that has not been
activated, so the plugin never changes how unrelated work behaves.

In a repository created from the better-craft app template, activation also records
`platform: better-craft-eks` and `layout: single-app`, and drops the template's `@AGENTS.md`
import from `CLAUDE.md`. The platform conventions reach the agent through `better-craft-platform`,
loaded when they matter; `AGENTS.md` itself stays untouched, for Jarvis and other tools.


## Rule 12 — Cost discipline (enforced)

A build that costs eight hours and 241 USD does not get run a second time, so cost is a
correctness property here, not a preference. Both numbers are measured, from one embeddable widget
built by this flow before this rule existed.

Cost in an agentic build is `turns x context x model rate`, and all three are governed:

- **Planning is expensive; execution is not.** Discovery, the spec, the expert review and the plan
  run at high reasoning effort. Once `implementation-plan.md` exists, every decision is written
  down: product source is written by `plan-executor` on the cheap model, and the session itself
  drops to the cheap model before the first dispatch. 130 USD of that 241 USD was an expensive
  model doing mechanical work.
- **Every dispatch names its model.** `model: 'sonnet'` on the dispatch, never `inherit` — an
  inherited model made one designer dispatch cost 69 USD, more than any epic of the actual build.
- **No full-resolution screenshot enters a context.** One is 80-170k tokens on the turn it is read
  and again on every later turn of that agent; 122 of them were the largest single token cost in
  that build. Capture at `scale: 0.5`, shrink with `${CLAUDE_PLUGIN_ROOT}/scripts/shrink_shot.py`, and take
  measurements from scripts (`${CLAUDE_PLUGIN_ROOT}/scripts/contrast_check.py`) rather than from pictures.
- **One command verifies an epic.** `bash verify.sh` in the initiative folder, created in the first
  epic from `${CLAUDE_PLUGIN_ROOT}/templates/verify.sh`. Executors that assembled their own sequences ran the production
  build 6-8 times and the type check 9-13 times per epic.
- **A dispatch is capped at 60 turns** and is given its epic's slice of the plan, not the whole
  file. An executor at 200 turns is re-reading its own context, not making progress.
- **Nobody waits.** Every question the user alone can answer is asked before the scope approval;
  mid-build questions cost 20-70 minutes each. A turn never ends with unticked tasks and no
  outstanding question, and an outstanding question never stops an epic that does not depend on it.

The first three are enforced by `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-cost-discipline.py`, which denies the tool call.
Each has an escape hatch — `BETTERCRAFT_ALLOW_OPUS_EXEC`, `BETTERCRAFT_OPUS_AGENTS`,
`BETTERCRAFT_ALLOW_BIG_IMAGES` — and using one is a decision recorded in the plan, not a default.

Report cost with `${CLAUDE_PLUGIN_ROOT}/scripts/estimate_build_cost.py`, which counts subagent transcripts: without them
a reported figure is wrong by the share of the work subagents did, measured at 75%.

---

## The build flow and the delivery modes

The phase-by-phase procedure and the delivery-mode definitions are **not repeated here**, because
this file is re-read on every turn of every session in this repository — including sessions that
never build anything. They live in the plugin and are loaded when a build actually starts:

- the procedure: the `governed-build-flow` skill (`/better-craft` is its front door)
- the delivery modes: the `tech-framework-selection` skill
- the full narrative text of both, plus these rules: `${CLAUDE_PLUGIN_ROOT}/references/operating-rules.md`

The twelve rules above are the part that has to be always-on: they are what the hooks enforce and
what applies whether or not a governed build is running.

## Output standards

- Reuse decisions: `reuse`, `extend`, or `build-new`.
- Review severity: `advisory`, `required`, or `blocking`.
- Label all build cost/token figures as **estimated**.

