/**
 * Structured observability log lines (T29, devops review required findings:
 * named observability destination, SLOs, expanded alerting).
 *
 * This project has no logging library and none is being added here — one
 * function, `logEvent`, writes one JSON object per line to stdout. That is
 * the entire "metrics" layer; the platform's standard log collection reads
 * stdout from every container, so a structured line here is already in reach
 * of whatever ingests and alerts on it, with no further wiring in this repo.
 *
 * Call sites (not duplicated here, just imported from):
 *  - src/workers/runQueue.ts — Run success/failure + duration, per-source
 *    Evidence counts per Run, the 10-minute Run SLO.
 * Connector-specific telemetry belongs behind the provider-neutral adapter
 * boundary and must not introduce provider names into this core module.
 */

export type MetricFields = Record<string, unknown>;

/** Emits one structured JSON log line. `fields` carries whatever is relevant
 * to `event` (ids, counts, durations, error text) — no fixed schema beyond
 * `event`/`timestamp`, since different events carry different shapes. */
export function logEvent(event: string, fields: MetricFields = {}): void {
  console.log(
    JSON.stringify({
      event,
      ...fields,
      timestamp: new Date().toISOString(),
    }),
  );
}

/** A Run's end-to-end completion ceiling (matches `runLast30Days`' own
 * 10-minute hard subprocess timeout, src/workers/runLast30Days.ts). A Run
 * that breaches this has, in practice, usually also just been marked
 * `failed` with "last30days subprocess timed out" by that timeout — this
 * function does not duplicate that timeout logic, it only reports the SLO
 * once a Run's actual duration is known, success or failure either way. */
export const RUN_COMPLETION_SLO_MS = 10 * 60 * 1000;

export function checkRunSlo(fields: { runId: number; brandId: number; marketId: number | null; durationMs: number }): void {
  if (fields.durationMs > RUN_COMPLETION_SLO_MS) {
    logEvent("run-slo-breached", { ...fields, sloMs: RUN_COMPLETION_SLO_MS });
  }
}
