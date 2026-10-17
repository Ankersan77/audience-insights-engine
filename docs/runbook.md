# Legacy research-run runbook

> Historical only. This document covers the disabled `last30days` research-run path scheduled for
> removal in Roadmap R1. It must not be used for new production operation.

This runbook covers the active product core. Provider-specific connector recovery belongs in the
adapter's own operational documentation and must use the generic acquisition and delivery
receipts defined in `src/connectors/contracts.ts`.

## Stuck or long-running research run

`runLast30Days` has a ten-minute subprocess timeout. A run still marked `running` after that
usually means the worker died before it recorded the terminal state.

```sql
SELECT id, brand_id, market_id, status, started_at, now() - started_at AS running_for
FROM research_run
WHERE status = 'running'
  AND started_at < now() - interval '10 minutes';
```

After confirming that the worker is no longer processing the run, mark it failed:

```sql
UPDATE research_run
SET status = 'failed',
    finished_at = now(),
    error_message = 'Manually marked failed — stuck past the run timeout.'
WHERE id = <confirmed_run_id>
  AND status = 'running';
```

The update preserves collected evidence and releases the active-run uniqueness guard. Restart and
health-check the worker before manually triggering a new run. Runs are never automatically retried.

## Worker crash mid-run

Confirm the worker process has restarted through the deployment platform, then use the same query
and guarded update above. Review structured `run-failed`, `run-succeeded`, and
`run-slo-breached` events around the crash timestamp before starting replacement work.

## Connector acquisition failure

Use the provider-neutral identifiers from `SourceAcquisitionReceipt`:

1. Locate the receipt by `jobId`, `clientId`, and `sourceId` in the operational store or logs.
2. Treat `errorCode` as adapter-owned diagnostic data; do not log resolved credentials or raw
   provider payloads.
3. Verify client scope, source policy, rights, and credential-reference resolution.
4. Retry only when the adapter documents the operation as idempotent and the same idempotency key
   is preserved.
5. Quarantine evidence when provenance, rights, or redaction cannot be proven.

## Restore readiness

Before production release, the deployment owner must document PostgreSQL backup frequency,
retention, encryption, restoration steps, and a timed restore test. A successful build or this
runbook is not evidence that restore has been tested.
