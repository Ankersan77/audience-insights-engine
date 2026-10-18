# ADR 0002: `last30days` runs as a local worker subprocess in the single platform-built image

- Status: Superseded; runtime removed by `ROADMAP.md` R1A2 (2026-10-18)
- Date: 2026-10-08
- Initiative: `init-20261002-audience-insights-engine` (Audience Insights Engine)

## Context

This product's live social-listening layer is provided by `last30days` (MIT-licensed, `github.com/mvanhorn/last30days-skill`), a ~63,000-line vendored Python CLI engine with no plugin or extension seam: adding a native source to it means hand-editing its core across several internal mechanisms (an if/elif fetch chain, a normalizer dict, render-table entries), none of which this product should depend on or modify. It must therefore be treated as an external, unmodified dependency, invoked as-is.

An initial draft of this design ran `last30days` as a second, Python-based container in the same Kubernetes pod as the Next.js/worker container ("sidecar"), communicating over `localhost` HTTP. Tech review during expert review of `product-spec.md` v1 did not object to this in principle, but devops review found it undeployable in the hosting setup used at the time: the pipeline built exactly one image per release and had no mechanism for a second image or a second container in one pod.

## Decision

`last30days` is vendored as a pinned git submodule (`vendor/last30days`, pinned to a specific upstream tag, bumped only after a named reviewer checks the upstream diff — it runs with live third-party API credentials). It is baked into the same multi-stage `Dockerfile` that builds the Next.js application, so the worker container has both a Node and a Python runtime available. The `pg-boss` worker invokes it as a **local subprocess**, per Run, reading its stdout directly — never over a network interface, and never patched in place.

This fits the platform's one-image/one-tag convention exactly: no custom CI workflow change, no custom chart template, no new container, no new Service, Ingress, or NetworkPolicy. `last30days`'s own source credentials (`X_BEARER_TOKEN`/`XAI_API_KEY`, optional `SCRAPECREATORS_API_KEY`) are injected as environment variables on the worker container only — the only container that ever invokes the subprocess — and are never read by the Next.js web process.

## Alternatives considered and rejected

**Sidecar container in the same pod, internal HTTP wrapper.** Rejected per devops review: not deployable from the stock platform chart/CI without a custom, devops-code-owned change to `.github/workflows` and the chart's deployment template, which was neither scoped nor approved.

**A second Deployment (the platform's existing worker-template pattern) running only `last30days`.** Considered but rejected: the platform's worker template builds a second Deployment from the *same* image, not a different one; `last30days` is Python, not Node, so this would still require a second image and the same CI problem as the sidecar option.

**Patching `last30days`'s core to expose a library interface instead of a CLI.** Rejected outright: the engine has no plugin seam, and patching a 63k-line vendored dependency in place forfeits any ability to pull clean upstream fixes and directly contradicts the project's own stated extension pattern (`CONTRIBUTING.md`/`CONCEPTS.md` describe no such interface).

## Consequences

- One image, one CI pipeline, one tag — no new deployment surface, no new network-reachable endpoint.
- The worker container is larger (carries a Python runtime and the vendored submodule) and needs CPU/memory sizing that accounts for running `last30days` as a child process; this is stated explicitly in `product-spec.md` §11 and sized in the implementation plan.
- Bumping the pinned submodule tag is a reviewed action (a named person checks the upstream diff before moving the pin), since it is third-party executable code running with live external API credentials.

## Supersession note

The target product is now AI-native and uses the canonical people-blind source-adapter boundary.
`last30days` runtime code, packaging, routes, Python dependency and submodule were removed in R1A2.
Historical database state remains unchanged pending R1B. This ADR remains only to explain the old
design; it must not be used to justify new dependencies or runtime work.
