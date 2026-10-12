# Runbook — Audience Insights Engine

Operational procedures beyond the platform's standard rollback runbook.
Covers the four scenarios specific to this product's own workers and
delivery paths, plus the release gates this document does not resolve.

## (a) A stuck / long-running Run

**How to spot one:** `runLast30Days` has its own 10-minute hard subprocess
timeout (`src/workers/runLast30Days.ts`), after which the job handler marks
the `research_run` row `failed` with `error_message = "last30days subprocess
timed out"`. A Run stuck in `running` well past 10 minutes means that
transition did not happen — most likely the worker process itself died
mid-Run (see scenario (c)) rather than the subprocess hanging past its own
timeout. T29 also logs a `run-slo-breached` structured event (10-minute
completion SLO) whenever a Run's actual duration exceeds this ceiling,
whether it succeeded, failed, or timed out — check the logs for that event
first.

Find one:

```sql
SELECT id, brand_id, market_id, status, started_at, now() - started_at AS running_for
FROM research_run
WHERE status = 'running'
  AND started_at < now() - interval '10 minutes';
```

**How to recover it:** there is no "resume" for a Run — mark it failed or
cancelled directly:

```sql
UPDATE research_run
SET status = 'failed', finished_at = now(), error_message = 'Manually marked failed — stuck past the 10-minute timeout (runbook).'
WHERE id = <id>;
```

This is a safe, idempotent update: `evidence` rows already written for this
Run (if any) are untouched, and T4's partial unique index
(`research_run_active_brand_market_unique`, on `(brand_id, market_id)` where
`status in ('queued','running')`) is released the moment this Run leaves
`running`, which is what actually unblocks a fresh trigger for the same
brand+market — the DB-level duplicate-Run guard does not expire on its own.
This Run is never auto-retried by anything in this system (tech review
required finding 9) — if the work still needs doing, trigger a new Run
manually from `/runs` once the stuck one is marked failed.

## (b) A Rill-allowlist-rejection spike

**What the alert means:** something is requesting a Rill view or field that
is not on `ALLOWED_RILL_MEASURES` (`src/lib/rillAllowlist.ts`), or a field
that passed the allowlist but matched the financial/regulated word-boundary
pattern filter and was stripped (`src/lib/rill.ts`). Every one of these is
both written to `audit_log` (`entity_type = 'rill_view'`, `action` one of
`rill-query-rejected` / `rill-query-field-stripped`) and emitted as the same
named structured log event (T29, `src/lib/metrics.ts`'s `logEvent`, called
from inside `src/lib/rill.ts`'s shared `audit()` helper) — a spike in either
is the same underlying signal.

**Where to look, in order:**

1. The structured logs — `grep` the worker/app's stdout for
   `"event":"rill-query-rejected"` or `"event":"rill-query-field-stripped"`;
   each line carries the `view` and `requestedFields` that triggered it.
2. The audit trail, for the same events with full historical context:
   ```sql
   SELECT id, user_id, entity_id AS run_id, action, before_json, created_at
   FROM audit_log
   WHERE entity_type = 'rill_view' AND action IN ('rill-query-rejected', 'rill-query-field-stripped')
   ORDER BY created_at DESC
   LIMIT 50;
   ```
3. Whether the requests correlate with one code path (a bug in
   `src/workers/pullRillEvidence.ts` asking for something it shouldn't) or
   look adversarial (a changed query shape hitting the allowlist
   deliberately) — the former is a bug fix, the latter is a security
   incident and should be escalated immediately, not just logged.

**Who to escalate to:** the named data-governance approver who owns
`CODEOWNERS`' gate on `src/lib/rillAllowlist.ts` — as of this writing that is
still a placeholder (`@BetterCollective/data-governance`, per
`product-spec.md` section 16's open item: the actual named approver has not
been confirmed). Until a real person is named, escalate to whoever currently
owns the Rill credential relationship (Martin/Patrick, per the credential
table in `implementation-plan.md`).

## (c) A worker crash mid-Run

**What happens:** `src/workers/index.ts` is a single standalone process
(`pnpm worker` / its container equivalent). If that process crashes or is
killed (not drained via SIGTERM/SIGINT — see its own graceful-shutdown
handler) while a `research_run` row is `running`, that row is simply
abandoned: nothing updates it, because the process that would have updated
it no longer exists. This looks identical, from the database's point of
view, to scenario (a) — a Run stuck in `running` past its 10-minute ceiling —
and is recovered the exact same way:

```sql
-- Identify it (same query as scenario (a))
SELECT id, brand_id, market_id, status, started_at
FROM research_run
WHERE status = 'running' AND started_at < now() - interval '10 minutes';

-- Recover it (same statement as scenario (a))
UPDATE research_run
SET status = 'failed', finished_at = now(), error_message = 'Manually marked failed — worker crash mid-run (runbook).'
WHERE id = <id>;
```

Then confirm the worker process itself is actually running again (container
restart policy / process supervisor, per the platform's own standard
rollback runbook — not duplicated here) before re-triggering the Run.

## (d) A Slack/Drive delivery failure beyond the in-UI retry

**What to check first:** `/insights`, filtered to "delivery failed" — every
Insight in that state carries its own stored failure message
(`insight.delivery_status = 'failed'`, matching E7's design), which for a
Slack failure is Slack's own API rejection text surfaced verbatim (e.g.
`"Slack rejected the message: channel_not_found"` — confirmed live in T23).
The in-UI "Retry" action re-attempts delivery and records the outcome the
same way; if that has already been tried and failed again, go to the
structured logs:

```text
grep '"event":"delivery-failed"' <worker/app log output>
```

Each line carries `channelId`, `channelType`, and a `reason` field
(`channel-missing`, `slack-not-configured`, `slack-rejected`, or
`unexpected`) plus Slack's own `message` where one exists (T29). A Drive
channel's delivery is logged separately as `"event":"delivery-skipped"` —
that one is expected and permanent (Drive write delivery is inert by design
until a write-capable credential exists, spec FR9; see "Out of scope for
this plan" in `implementation-plan.md`), not an incident to chase.

**What usually explains each reason:**

- `channel-missing` — the mapped `channel` row was deleted after the
  Insight's type was routed to it; re-map the Insight type on `/channels` to
  a channel that still exists, then retry.
- `slack-not-configured` — `SLACK_BOT_TOKEN` is absent from the running
  process's environment; this is a deployment/secret problem, not a
  per-message one, and will fail for every Slack delivery until fixed.
- `slack-rejected` — Slack's API itself rejected the call (invalid channel
  id, bot not a member of a private channel, revoked token scope); the exact
  Slack error string is in the log line and in `insight`'s own stored
  message.
- `unexpected` — a non-`SlackSendError`/`SlackNotConfiguredError` exception
  (network failure, timeout); check the raw error in the worker/app's error
  log around the same timestamp.

## Open release gates not resolved by this document

Named here so this runbook does not imply either is already handled —
both are release gates owned elsewhere, per `product-spec.md` section 16 and
`implementation-plan.md`'s "Out of scope for this plan":

- **Postgres backup/restore definition and a performed, timed restore test**
  — owner: `@BetterCollective/devops`. This plan built the backup
  *configuration* only (E9); nobody has yet proven a restore actually works.
  Do not treat this runbook's existence as evidence that a restore has been
  tested.
- **Greece/EU Legal sign-off for data processing** — owner: Legal (named
  person still pending, per spec §16's open item). Greece is gated off by
  `market.processing_enabled = false` (T20) until this sign-off happens; that
  flag, not this document, is what keeps Greek-market processing from
  running today.
