# Product specification — superseded

The original **Audience Insights Engine** specification described a client-specific
internal tool built around Rill, Slack, and an approval queue. That product definition was
superseded on 2026-10-16.

The canonical product specification is now [`BLUEPRINT.md`](BLUEPRINT.md).

Important changes include:

- Market Research is a reusable, client-configurable D4WN product.
- The Market Twin is the client-specific intelligence center.
- The data boundary is trend-first and people-blind; the product does not create consumer profiles.
- Evidence, hypotheses, insights, recommendations, and causal learnings are separate types.
- Campaign pre-flight, live analysis, post-campaign learning, and Brand Lift methods are part of
  the product boundary.
- Slack and Rill are not product dependencies.
- Connectors, providers, and product surfaces are replaceable adapters.

This file remains only as a stable pointer for old links. Do not add product requirements here.
