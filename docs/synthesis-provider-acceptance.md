# Research synthesis transport and activation gate

## Implemented boundary

`ResearchSynthesisProvider` remains the provider-neutral Core interface. The optional
`OpenAIResearchSynthesisProvider` implements it using the Responses API. It is not imported by
the production factory and does not select OpenAI as the deployment's vendor. There is no new
environment switch or automatic use of an existing API key. All verification so far uses an
injected synthetic HTTP transport, not a paid request or a real provider acceptance run.

The versioned prompt and output schema live in `src/abilities/synthesisPrompt.ts`; the connector
owns transport only. The prompt uses the installed ability's intent, method, rubric and human
gates. It separates evidence and prior synthesis, preserves methodology and contradictions, and
asks for client relevance, alternative explanations, falsification conditions and a next decision.
These instructions are not proof of reasoning quality or comprehensive prompt-injection defense.

Core selects eligible evidence and reviewed Market Twin context before calling a provider, then
validates its untrusted proposal. The existing database save path revalidates the evidence/context
snapshot. The adapter additionally requires an exact client, market, language, enabled ability,
allowed source classes and an unexpired server-owned binding. Binding objects are copied so callers
cannot broaden their scope after construction. An acceptance reference in a binding is metadata,
not independent verification of an agreement or account setting.

The request projects only research-relevant fields. Tenant/configuration IDs, credential references,
review-role assignments and source URLs are not sent. Evidence IDs remain as citation handles.
Core no longer silently clips selected source text at 12,000 characters: long reports may contain
material caveats at the end. The adapter rejects an oversized request; it never silently removes
selected evidence or methodology to fit. A reviewed extract or narrower research scope is needed.

## Transport guarantees and limits

- Explicit model; no default, automatic upgrade, fallback provider or client fallback.
- Fixed HTTPS Responses endpoint; redirects are rejected. No user-selected URL or SSRF surface.
- Static structured-output schema, with no client data embedded in the schema itself.
- `store: false`, `background: false`, no tools, files, conversations or prompt-cache configuration.
- Bounded UTF-8 request bytes, output token ceiling, total response bytes and overall timeout
  (including body reads). These are resource limits, **not a currency budget or invoice**.
- One HTTP attempt only. Refusals, incomplete/ambiguous outputs, tool calls and malformed JSON fail
  closed. No output repair, retry, redirect following or second paid request.
- Provider errors and raw response bodies are not logged or returned. Hidden reasoning is ignored.
- A binding that expires during execution cannot release a usable result. Cancellation/timeout
  does not prove the provider did no work and does not authorize refunding a spend reservation.

The output still passes through Core's citation, required-field and causal-claim gates. These do
not certify that prose is substantively correct; named human review and benchmark evidence remain
required. Public-conversation material is not automatically safe because it passed a regex check.
Normal ingestion, rights, minimization, reviewed excerpts and current source policy remain required.

## Required before production integration

1. Select the vendor/model and pilot client; obtain explicit source processing permission, data
   classifications, retention/residency acceptance and a secret-store credential reference.
2. Verify account/project retention independently. `store: false` is **not** Zero Data Retention.
   Standard API abuse-monitoring retention must be explicitly accepted if applicable; a configured
   `zero_data_retention` label is not proof that OpenAI enabled it for the account/project/model.
3. Add durable, client-scoped synthesis admission and usage/audit records. Reserve a defensible
   currency-tagged cost ceiling before credential access or HTTP dispatch, including concurrent
   calls and unknown outcomes. Acquisition budgets do not currently authorize synthesis requests.
   Provider usage reconciliation, cancellation and revocation handling still need implementation.
4. Resolve bindings from trusted server configuration, not request JSON. Recheck current source
   processing permission and binding approval at dispatch; persist only normalized metadata.
5. Run representative and adversarial tasks through the actual selected model with approved pilot
   data. Record human scorecards for evidence accuracy, methodological fidelity, contradiction
   handling, client relevance, privacy and decision usefulness. Record requested/actual model,
   prompt/adapter versions, processing acceptance and usage without retaining raw provider payloads.
6. Only after these checks, replace `getProductionSynthesisProvider()`'s absent-provider result with
   the governed adapter resolution. Exercise the authenticated HTTP path, expiry/revocation races,
   durable spend limits and failure recovery before enabling it for a client.

This is aligned with the blueprint's separation of Core, abilities and connectors, not a claim
that the Python D4WN service has been integrated or that its acceptance transfers to this product.
There is no runtime dependency on another local repository.

## Protocol references

Checked against official OpenAI documentation on 2026-10-16:

- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses
  `text.format` JSON schema and explicit refusal handling. Core still validates returned proposals.
- [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses):
  typed output items and explicit `store: false`.
- [Data controls](https://developers.openai.com/api/docs/guides/your-data): account/project retention
  controls and the distinction between application-state storage and abuse-monitoring retention.
