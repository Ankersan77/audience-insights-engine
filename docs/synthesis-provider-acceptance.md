# Research synthesis transport and activation gate

## Implemented boundary

`ResearchSynthesisProvider` remains the provider-neutral Core interface. The optional
`OpenAIResearchSynthesisProvider` implements it using the Responses API. The server composition
root (`src/lib/productionSynthesis.ts`) can now resolve an explicitly configured client binding,
but defaults to no provider. Shipping this adapter does not select OpenAI for any client. It never
automatically uses a generic API key. All verification so far uses an injected synthetic HTTP
transport, not a paid request or a real provider acceptance run.

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
4. Supply the trusted server configuration described below, not request JSON. Production now
   rechecks the exact binding, current acceptance gates, approved source inventory, source rights,
   selected evidence/methods and reviewed Market Twin at reservation, dispatch and result release.
   These checks use database locks and repeat time/configuration checks after audit writes.
5. Run representative and adversarial tasks through the actual selected model with approved pilot
   data. Record human scorecards for evidence accuracy, methodological fidelity, contradiction
   handling, client relevance, privacy and decision usefulness. Record requested/actual model,
   prompt/adapter versions, processing acceptance and usage without retaining raw provider payloads.
6. Only after these checks, configure the reviewed binding, acceptance gates, secret reference and
   synthesis allowance in the selected deployment. The production factory is wired; missing or
   invalid configuration still returns no provider, and missing authority fails before credentials.
   Complete the real-provider HTTP/pilot, metering and deployment evidence before launch.

This is aligned with the blueprint's separation of Core, abilities and connectors, not a claim
that the Python D4WN service has been integrated or that its acceptance transfers to this product.
There is no runtime dependency on another local repository.

## Deployment binding and acceptance scopes

`MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON` is server-only configuration with `schemaVersion: 1` and a
`bindings` array (maximum 100 clients / 64 KB). One exact numeric database `clientId` per binding;
no default/fallback tenant. Unknown fields, duplicate clients, arbitrary endpoint overrides and
embedded credential values are rejected. The current adapter catalog contains `openai-responses`;
other providers require their own reviewed adapter, not a change to research logic.

Example **template**, deliberately invalid until every replacement value is supplied:

```json
{
  "schemaVersion": 1,
  "bindings": [{
    "clientId": "REPLACE_WITH_CLIENT_ID",
    "adapterId": "openai-responses",
    "model": "REPLACE_WITH_APPROVED_MODEL",
    "abilityIds": ["market-category-diagnosis"],
    "markets": ["DK"],
    "languages": ["da"],
    "allowedSourceClasses": ["official_or_public"],
    "sourceConnectionIds": ["REPLACE_WITH_APPROVED_SOURCE_ID"],
    "approvalReference": "processing:REPLACE_WITH_EVIDENCE",
    "qualityApprovalReference": "quality:REPLACE_WITH_EVIDENCE",
    "expiresAt": "REPLACE_WITH_REVIEW_EXPIRY",
    "retention": "standard_api_store_false",
    "credentialEnv": "MARKET_RESEARCH_MODEL_KEY_CLIENT",
    "currency": "DKK",
    "maxCostMicros": "REPLACE_WITH_INTEGER_MICROS",
    "maxInputBytes": 100000,
    "maxOutputTokens": 2000,
    "maxResponseBytes": 100000,
    "timeoutMs": 60000
  }]
}
```

Use approved markets/languages/classes, enough separately permitted sources, a future ISO expiry,
and a **number**, not a string, for `maxCostMicros`. The example retention choice is not an approval
to use standard retention. Provider/account/data-class acceptance must establish the actual policy;
`zero_data_retention` remains an externally verified account property, not a request parameter.

Validate a non-secret config file and calculate the exact acceptance scope with:

```sh
npm run synthesis:check -- --file ./deployment-synthesis.json --client-id 123
```

This read-only command prints the model, source inventory, cost ceiling, evidence references and
scope; it does not read a credential, approve a gate, create a budget or call a provider. The
`live_connectors` and `research_quality` gates must both be `verified`, have a named reviewer/owner,
future expiry, and exactly match the printed `research-synthesis:<configuration-digest>` scope and
their respective evidence references. Record real review evidence through Evaluation. A copied
hash or template reference is not that evidence. Existing quality-scorecard requirements still
apply. Changing the model, source list, retention, key reference, limits or any other binding field
requires matching new acceptance. Retain the reviewed configuration revision with its acceptance
evidence so the digest in the spend ledger is historically reproducible.

Install the JSON in the server environment, and the actual key separately under the binding's
dedicated `MARKET_RESEARCH_MODEL_KEY_*` variable in the deployment secret store. The existing
`ENABLE_ENV_CREDENTIAL_RESOLVER=true` is also required. There is no `OPENAI_API_KEY` fallback, and
the reference cannot select unrelated secrets such as `DATABASE_URL`. Keys are resolved only
after the durable reservation and one-use dispatch. These bindings and budgets are intentionally
not copied in portable client solution packages; each destination needs its own approval.

The Ask/Projects brief route supplies the authenticated tenant and request cancellation signal;
request JSON cannot choose a provider, binding or key. Analyst-authored briefs do not instantiate
a provider. Removing configuration, disabling credential resolution, changing the synthesis
budget, withdrawing either acceptance gate, or withdrawing source permission stops new admitted
work and suppresses later result authorization. A dispatch already committed cannot be undone;
deploy/restart all workers when changing environment configuration, and use database gate/budget
revocation for immediate cross-process enforcement. No network call runs inside a database lock.

Database tests exercise the actual configured factory plus Responses adapter with a synthetic
HTTP transport, persisted briefs, stale context/methods, source exclusion, acceptance/configuration
withdrawal and lock contention. Real authenticated HTTP tests prove absent configuration stays
`needs_context` and client-supplied credentials are ignored. Test HTTP processes explicitly clear
model bindings/keys. A fully configured **live-provider** HTTP journey remains unverified.

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
