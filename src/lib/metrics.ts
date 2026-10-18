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
 * Call sites are canonical acquisition, synthesis and maintenance workers.
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
