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
3. Connect the selected adapter through `withSynthesisBudget` and the PostgreSQL
   `synthesisSpendLedger`. Migration `0015` implements separate client-scoped daily cost/request
   admission, one-use dispatch, versioned revocation, terminal audit and crash reconciliation.
   Acquisition budgets do not authorize synthesis. The approved planner must supply a defensible
   currency-tagged upper bound and the adapter must perform only the bounded single request;
   this trusted-code contract is not a network sandbox or a proof of provider pricing. Actual
   provider usage/invoice reconciliation and live cost-bound acceptance still need implementation.
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

## Durable admission implementation

`src/abilities/synthesisBudget.ts` defines the provider-neutral budget/plan/ledger contract.
`withSynthesisBudget` freezes a per-call input and plan, reserves a digest-only attempt, claims a
one-use dispatch permit, and only then invokes the credential-owning provider factory. Provider
identity/version must match the plan. Deadline and cancellation signals cover factory resolution
and synthesis; a late factory cannot start a request, and a late answer cannot overwrite an unknown
outcome. A failed ledger write suppresses the answer and never triggers an automatic paid retry.

`src/db/queries/synthesis_budget.ts` serializes admissions and policy updates per client. Every
reservation consumes its full upper bound and one request for its UTC admission day, including
failed/cancelled/unknown attempts. Dispatch must happen within 60 seconds, before UTC midnight and
before binding expiry; it cannot be replayed. The database supplies the execution deadline.
Every budget update increments its version, invalidating undispatched grants and later result
authorization for older versions. This cannot undo a request already sent to a provider.

Reservation, dispatch and completion audit are atomic. Expiry is checked after potentially blocked
audit writes as well as after acquiring locks. Successful provider execution is recorded separately
from Core's validation and human approval; budget authorization does not certify the answer or
promote client truth. No prompts, answers, raw usage payloads or credentials enter this ledger.
Application/database clocks must be synchronized; database checks remain authoritative at commit.

The operator CLI supports `show`, `set` and bounded `reconcile` (see the runbook). Reconciliation
turns expired undispatched reservations into `cancelled`, and expired dispatched attempts into
`unknown`. It never retries or refunds. A recurring reconciler and the owned-surface budget editor
are not wired yet. Synthetic PostgreSQL tests cover concurrency, tenant isolation, revocation,
expiry during audit contention, crash reconciliation and the actual governance wrapper. They do
not replace real provider metering/processing acceptance or pilot quality evidence.

## Protocol references

Checked against official OpenAI documentation on 2026-10-16:

- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses
  `text.format` JSON schema and explicit refusal handling. Core still validates returned proposals.
- [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses):
  typed output items and explicit `store: false`.
- [Data controls](https://developers.openai.com/api/docs/guides/your-data): account/project retention
  controls and the distinction between application-state storage and abuse-monitoring retention.
