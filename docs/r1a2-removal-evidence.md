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

R1A2 passed on immutable candidate revision
`5eadfa584ee4791286d4488a3fcf4810f3a65a86` in GitHub Actions run
[`39126749699`](https://github.com/man-D4wn/Market-research/actions/runs/39126749699). The run built
both revision-labelled Docker targets and uploaded artifact
`r1a2-image-inspection-5eadfa584ee4791286d4488a3fcf4810f3a65a86` (artifact ID
`12136377274`) with these immutable identifiers:

- web image: `sha256:a743484327ea82e22baf8da41f7d6d78cd1c7e99c89f392764c7b2b197eb264c`;
- worker image: `sha256:9d250a191c275ce77b0aefdb094f6a11b5edfa904d3a0cdaa204f3136cd5d9b0`;
- worker artifact SHA-256:
  `5195aed6383de6ed6d6b11e73946067c596abf29dd41019e22ec12af1f43372d`.

The uploaded inspection report records `noPython: true`, `noVendoredEngine: true`, 20 removed
legacy/monitoring routes returning 404, and a permission-gated neutral cancellation route. It also
records exactly these product queues:

- `market-research-canonical-maintenance`;
- `market-research-source-acquisition`;
- `market-research-synthesis-maintenance`.

The only additional queue is pg-boss infrastructure queue `__pgboss__send-it`. The two expected
schedules are `market-research-canonical-maintenance` and
`market-research-synthesis-maintenance`; the retired monitoring schedule is absent. The same exact
worker image completed deterministic in-flight SIGTERM drain and restart catch-up checks, recorded
as `gracefulDrain: true` and `restartCatchUp: true`.

## Conclusion

**R1A2 passed.** Executable legacy code, user-facing legacy/monitoring surfaces and legacy packaging
are removed. Canonical behavior remains green, and legacy schema, migrations and rows remain
unchanged and operator-readable pending the separately approved R1B disposition.
