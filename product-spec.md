# Product specification — superseded

The original **Audience Insights Engine** specification described a client-specific
internal tool built around Rill, Slack, and an approval queue. That product definition was
superseded on 2026-10-16.

The canonical product specification is now [`BLUEPRINT.md`](BLUEPRINT.md).

Blueprint 2.0.0 makes the following product decisions canonical:

- Market Research is an AI-native, client-isolated service used from the customer's chosen AI host.
- Remote MCP is the canonical version 1 integration boundary.
- The D4WN Denmark competitor/positioning brief is the only version 1 production ability.
- The web application is a secondary administration and review surface.
- Managed single-tenant is the default deployment; customer-operated single-tenant is an enterprise
  option.
- The Market Twin is a bounded, reviewed evidence model, not a universal knowledge graph.
- The data boundary is trend-first and people-blind; the product does not create consumer profiles.
- Evidence, hypotheses, insights, recommendations, and causal learnings are separate types.
- Campaign lifecycle, Brand Lift, broad monitoring and additional abilities are deferred from v1.
- Slack, Rill and `last30days` are not target product dependencies.
- Connectors, providers, and product surfaces are replaceable adapters.

This file remains only as a stable pointer for old links. Do not add product requirements here.
