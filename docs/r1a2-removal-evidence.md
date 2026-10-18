# R1A2 legacy code and packaging removal evidence

## Scope and boundary

R1A2 removes the executable `last30days` and brand/instruction/run/insight application cluster. It
does not change `src/db/schema.ts`, migrations `0001`–`0019`, snapshots or stored rows. The read-only
legacy inventory command, representative upgrade test and DSR procedure remain available until the
separately approved R1B disposition and forward migration.

The current estate is verified-zero, so there was no deployed route, queue, schedule or data copy to
quiesce. Discovery of any contrary installation reopens the R1A2 cutover gate before deployment.

## Candidate assertions

- removed UI routes: `/brands`, `/brands/:id/instructions`, `/runs`, `/runs/:id`, `/insights`;
- removed APIs: brand create/update/instructions, run trigger/cancel and insight decisions;
- removed runtime: legacy queue, subprocess wrapper, compact parser, direct model drafting,
  feature flag, purger and legacy-only telemetry;
- removed packaging: Python, vendored engine, Git submodule and CI submodule checkout;
- canonical worker artifact: bundled Node 24 ESM, non-root worker image, separate from the web
  image and its HTTP health check;
- retired monitoring schedule: unscheduled idempotently before canonical queue registration;
- disabled monitoring surface: navigation, page and monitoring/briefing APIs return 404, while
  canonical acquisition cancellation moved to a neutral permission-gated, tenant-scoped route;
- preserved product queues: acquisition, bounded canonical maintenance and synthesis maintenance;
  pg-boss may additionally expose only its internal `__pgboss__send-it` infrastructure queue;
- preserved data access: controlled aggregate inventory SQL only, pending R1B.

## Automated release evidence

CI must build both revision-labelled Docker targets and upload
`r1a2-image-inspection-<commit>` containing immutable image IDs and the worker artifact SHA-256. The
same job checks all removed legacy and monitoring routes as 404, confirms the neutral cancellation
route remains permission-gated, confirms the images contain neither Python nor the
vendored engine, starts the exact worker image against a fresh PostgreSQL 16 database, verifies only
the three canonical product queues, the single allowed pg-boss infrastructure queue and two
canonical schedules, exercises maintenance, drains on SIGTERM,
restarts and catches up queued work.

The final CI run and commit are recorded here only after that candidate has passed. Until then this
document describes the required evidence, not a production-support claim.
