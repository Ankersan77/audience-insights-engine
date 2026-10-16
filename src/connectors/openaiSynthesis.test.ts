import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResearchSynthesisProvider, SynthesisAdapterError, type OpenAISynthesisBinding } from "./openaiSynthesis.ts";
import type { ResearchSynthesisInput } from "../abilities/synthesis.ts";
import { runContextualResearch } from "../abilities/synthesis.ts";
import { getProductionSynthesisProvider } from "../abilities/productionSynthesis.ts";
import { RESEARCH_SYNTHESIS_SCHEMA } from "../abilities/synthesisPrompt.ts";
import type { ResearchContextSources } from "../abilities/context.ts";
import type { EvidenceItem } from "../core/contracts.ts";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const KEY = "synthetic-not-a-real-key";
function binding(): OpenAISynthesisBinding {
  return {
    clientId: "client-a", model: "explicit-test-model", abilityIds: ["market-category-diagnosis"],
    markets: ["DK"], languages: ["da"], allowedSourceClasses: ["official_or_public"],
    approvalReference: "acceptance:fixture", expiresAt: "2026-10-17T10:00:00Z", retention: "standard_api_store_false",
    maxInputBytes: 100_000, maxOutputTokens: 2_000, maxResponseBytes: 100_000, timeoutMs: 1_000,
  };
}
function evidence(id: string): EvidenceItem {
  return {
    id, clientId: "client-a", collectionId: `collection-${id}`, sourceConnectionId: `source-${id}`,
    sourceClass: "official_or_public", externalReference: "safe-but-not-needed-by-model",
    sourceContent: "Aggregate category purchasing increased in the observed window.",
    synthesis: "Prior analyst interpretation, not a new source.",
    method: { method: "Published aggregate", universe: "Adults in DK", sampleSize: 1200, limitations: ["Selection bias remains."] },
    applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] },
    confidence: 0.8, grade: "B", observedAt: "2026-10-15T10:00:00Z", ingestedAt: "2026-10-15T10:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z", lifecycle: "live", citationLevel: "statistical",
    rights: { basis: "public_permitted", commercialUse: true, quotationAllowed: false, restrictions: [] },
    sensitive: false, identityRisk: false, redactions: [], contentHash: `hash-${id}`,
  };
}
function input(): ResearchSynthesisInput {
  return {
    clientId: "client-a", abilityId: "market-category-diagnosis", question: "Hvad har ændret sig?", market: "DK", language: "da",
    evidence: [evidence("one"), evidence("two")], context: {
      clientId: "client-a", market: "DK", language: "da",
      solution: { id: "internal-solution-id", version: 1, markets: ["DK"], languages: ["da"], enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }], reviewRoles: { research: ["internal-reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } },
      project: { id: "internal-project-id", name: "Category decision", decision: "Choose the next research step.", updatedAt: "2026-10-15T10:00:00Z" },
      marketTwin: [{ id: "strategy", kind: "fact", title: "Reviewed strategy", statement: "Prioritize accessible quality.", evidenceIds: ["one"], contradictionIds: ["alternative"], confidence: 0.8, uncertainty: ["Validate in the next study."], reviewedAt: "2026-10-15T10:00:00Z" }],
    },
  };
}
const analysis = {
  pointOfView: "A descriptive category change warrants investigation.", clientRelevance: "The current decision concerns category investment.",
  recommendation: "Validate with a bounded study.", nextDecision: "Choose the study scope.", claimMode: "descriptive",
  evidenceIds: ["one", "two"], contradictions: ["The reviewed strategy has an explicit alternative."], uncertainty: ["Seasonality may explain the change. A representative repeat study could change this conclusion."],
};
function envelope(result: unknown = analysis) {
  return { status: "completed", error: null, incomplete_details: null, output: [
    { type: "reasoning", summary: [{ text: "never-expose-hidden-reasoning" }] },
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(result) }] },
  ] };
}
function adapter(transport: typeof fetch, config = binding(), now = () => NOW) {
  return new OpenAIResearchSynthesisProvider({ binding: config, apiKey: KEY, transport, now });
}
const errorCode = (code: string) => (error: unknown) => error instanceof SynthesisAdapterError && error.code === code;

test("Responses adapter sends bounded stateless JSON with ability expertise and only projected research data", async () => {
  let calls = 0;
  const provider = adapter(async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.method, "POST");
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${KEY}`);
    assert.ok(options?.signal);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "explicit-test-model");
    assert.equal(body.store, false);
    assert.equal(body.background, false);
    assert.equal(body.max_output_tokens, 2000);
    assert.deepEqual(body.text.format, { type: "json_schema", name: "research_analysis", strict: true, schema: RESEARCH_SYNTHESIS_SCHEMA });
    assert.match(body.instructions, /Triangulate market structure/);
    assert.match(body.instructions, /what evidence would change the conclusion/);
    assert.equal(body.input[0].role, "user");
    const data = JSON.parse(body.input[0].content);
    assert.deepEqual(data.evidence[0].method, input().evidence[0].method);
    assert.equal(data.evidence[0].priorSynthesis, input().evidence[0].synthesis);
    assert.deepEqual(data.marketTwin[0].contradictionIds, ["alternative"]);
    assert.equal(data.language, "da");
    for (const privateValue of [KEY, "client-a", "internal-solution-id", "internal-project-id", "internal-reviewer", "safe-but-not-needed-by-model"])
      assert.ok(!String(options?.body).includes(privateValue));
    for (const prohibited of ["tools", "previous_response_id", "conversation", "metadata", "prompt_cache_key", "prompt_cache_retention"])
      assert.equal(body[prohibited], undefined);
    return Response.json(envelope());
  });
  assert.deepEqual(await provider.synthesize(input()), analysis);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(provider).includes(KEY));
  assert.ok(!JSON.stringify(provider).includes("client-a"));
  assert.match(provider.version, /research-synthesis@1:explicit-test-model/);
});

test("adapter configuration fails closed without an explicit model, scope, acceptance and finite bounds", async (t) => {
  const cases: [string, Partial<OpenAISynthesisBinding>][] = [
    ["missing model", { model: "" }], ["invalid model", { model: "model\nheader" }],
    ["no client", { clientId: "" }], ["unsupported ability", { abilityIds: ["brand-lift-study"] }],
    ["no ability", { abilityIds: [] }], ["no market", { markets: [] }], ["no language", { languages: [] }],
    ["unknown source class", { allowedSourceClasses: ["unknown" as never] }], ["no approval", { approvalReference: "" }],
    ["invalid expiry", { expiresAt: "not-a-date" }], ["unknown retention", { retention: "guess" as never }],
    ["unbounded input", { maxInputBytes: Infinity }], ["fractional output", { maxOutputTokens: 300.5 }],
    ["unbounded response", { maxResponseBytes: 2_000_001 }], ["unbounded timeout", { timeoutMs: 120_001 }],
  ];
  for (const [name, patch] of cases) await t.test(name, () => {
    assert.throws(() => adapter(async () => { throw new Error("must not run"); }, { ...binding(), ...patch }), errorCode("binding-invalid"));
  });
  assert.throws(() => new OpenAIResearchSynthesisProvider({ binding: binding(), apiKey: "key\r\ninjected" }), errorCode("binding-invalid"));
});

test("cross-client, out-of-scope, stale approval and broken context never reach transport", async (t) => {
  const cases: [string, (request: ResearchSynthesisInput) => void, string][] = [
    ["foreign client", (i) => { i.clientId = "client-b"; }, "scope-denied"],
    ["foreign context", (i) => { i.context!.clientId = "client-b"; }, "scope-denied"],
    ["no context", (i) => { i.context = undefined; }, "scope-denied"],
    ["unbound market", (i) => { i.market = "SE"; }, "scope-denied"],
    ["unbound language", (i) => { i.language = "en"; }, "scope-denied"],
    ["context market", (i) => { i.context!.market = "SE"; }, "scope-denied"],
    ["unbound ability", (i) => { i.abilityId = "competitor-intelligence"; }, "scope-denied"],
    ["source class", (i) => { i.evidence = [{ ...i.evidence[0], sourceClass: "client_owned" }]; }, "scope-denied"],
    ["missing evidence", (i) => { i.evidence = []; }, "input-invalid"],
    ["duplicate evidence", (i) => { i.evidence = [i.evidence[0], i.evidence[0]]; }, "input-invalid"],
    ["missing Market Twin", (i) => { i.context!.marketTwin = []; }, "input-invalid"],
    ["missing lineage", (i) => { i.context!.marketTwin = [{ ...i.context!.marketTwin[0], evidenceIds: ["missing"] }]; }, "input-invalid"],
    ["disabled ability", (i) => { i.context!.solution.enabledAbilities = []; }, "input-invalid"],
    ["identifying question", (i) => { i.question = "Analyze person@example.com"; }, "input-invalid"],
    ["identifying evidence", (i) => { i.evidence = [{ ...i.evidence[0], sourceContent: "From @someone" }]; }, "input-invalid"],
  ];
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return Response.json(envelope()); };
  for (const [name, mutate, code] of cases) await t.test(name, async () => {
    const request = input(); mutate(request);
    await assert.rejects(adapter(transport).synthesize(request), errorCode(code));
  });
  await assert.rejects(adapter(transport, { ...binding(), expiresAt: new Date(NOW).toISOString() }).synthesize(input()), errorCode("binding-expired"));
  await assert.rejects(adapter(transport, binding(), () => NaN).synthesize(input()), errorCode("binding-expired"));
  assert.equal(calls, 0);
});

test("caller cannot mutate an accepted binding to broaden scope", async () => {
  const config = binding();
  let calls = 0;
  const provider = adapter(async () => { calls++; return Response.json(envelope()); }, config);
  config.markets = ["SE"];
  config.clientId = "client-b";
  const foreign = input(); foreign.clientId = "client-b"; foreign.context!.clientId = "client-b";
  await assert.rejects(provider.synthesize(foreign), errorCode("scope-denied"));
  assert.deepEqual(await provider.synthesize(input()), analysis);
  assert.equal(calls, 1);
});

test("byte budget rejects oversized UTF-8 input rather than silently dropping evidence", async () => {
  let calls = 0;
  const request = input();
  request.evidence = [{ ...request.evidence[0], sourceContent: "🧪".repeat(10_000) }];
  await assert.rejects(adapter(async () => { calls++; return Response.json(envelope()); }, { ...binding(), maxInputBytes: 30_000 }).synthesize(request), errorCode("input-too-large"));
  assert.equal(calls, 0);
});

test("HTTP errors, redirects and network failures have no implicit retry and expose no payload", async (t) => {
  for (const status of [301, 401, 403, 429, 500, 503]) await t.test(String(status), async () => {
    let calls = 0;
    await assert.rejects(adapter(async () => { calls++; return new Response(`private-provider-message ${KEY}`, { status }); }).synthesize(input()), errorCode("provider-failed"));
    assert.equal(calls, 1);
  });
  await assert.rejects(adapter(async () => { throw new Error(`request ${KEY} private-content`); }).synthesize(input()), (error: unknown) => {
    assert.equal(String(error), "SynthesisAdapterError: research-synthesis:provider-failed");
    assert.equal((error as Error).cause, undefined);
    return true;
  });
});

test("incomplete, refused, tool and ambiguous responses cannot produce an analysis", async (t) => {
  const values = [
    null, {}, { ...envelope(), status: "incomplete" }, { ...envelope(), status: "queued" },
    { ...envelope(), error: { message: KEY } }, { ...envelope(), incomplete_details: { reason: "max_output_tokens" } },
    { ...envelope(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "Refused" }] }] },
    { ...envelope(), output: [{ type: "function_call", name: "bad-tool" }] },
    { ...envelope(), output: [...envelope().output, envelope().output[1]] },
    { ...envelope(), output: [{ ...envelope().output[1], role: "user" }] },
    { ...envelope(), output: [{ ...envelope().output[1], status: "in_progress" }] },
  ];
  for (const [index, value] of values.entries()) await t.test(String(index), async () => {
    await assert.rejects(adapter(async () => Response.json(value)).synthesize(input()), errorCode("response-invalid"));
  });
  await assert.rejects(adapter(async () => new Response("not JSON with private content")).synthesize(input()), errorCode("provider-failed"));
  await assert.rejects(adapter(async () => Response.json({ ...envelope(), output: [{ ...envelope().output[1], content: [{ type: "output_text", text: "```json\n{}\n```" }] }] })).synthesize(input()), errorCode("provider-failed"));
});

test("response size is enforced with and without content-length", async () => {
  await assert.rejects(adapter(async () => new Response("{}", { headers: { "content-length": "100001" } })).synthesize(input()), errorCode("response-too-large"));
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1500)); controller.enqueue(new Uint8Array(1500)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(adapter(async () => new Response(stream), { ...binding(), maxResponseBytes: 2000 }).synthesize(input()), errorCode("response-too-large"));
  assert.equal(cancelled, true);
});

test("deadline covers connection and body read, aborts transport, and never retries", async () => {
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  await assert.rejects(adapter(async (_url, options) => {
    calls++; signal = options?.signal;
    return new Promise<Response>(() => {});
  }, { ...binding(), timeoutMs: 10 }).synthesize(input()), errorCode("timeout"));
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  await assert.rejects(adapter(async () => new Response(stream), { ...binding(), timeoutMs: 10 }).synthesize(input()), errorCode("timeout"));
  assert.equal(cancelled, true);
});

test("an approval that expires during a provider call cannot release its response", async () => {
  let now = NOW;
  const config = { ...binding(), expiresAt: new Date(NOW + 1000).toISOString() };
  await assert.rejects(adapter(async () => { now += 1000; return Response.json(envelope()); }, config, () => now).synthesize(input()), errorCode("binding-expired"));
});

test("optional transport runs through real Core orchestration; structured output does not bypass claim gates", async (t) => {
  const request = input();
  const sources: ResearchContextSources = {
    solution: { ...request.context!.solution, clientId: request.clientId, status: "active", providerBindings: { first: "one", second: "two" }, createdAt: new Date(NOW).toISOString() },
    intelligence: request.context!.marketTwin.map((item) => ({ ...item, clientId: request.clientId, lifecycle: "live", reviewState: "accepted", dependencyIds: [], applicability: evidence("one").applicability, synthesisBy: "human", createdAt: new Date(NOW - 1).toISOString() })),
    evidence: [evidence("one"), evidence("two")], sourceBindings: { one: "source-one", two: "source-two" },
  };
  const execute = (result: unknown) => runContextualResearch({ clientId: request.clientId, abilityId: request.abilityId, question: request.question, market: "DK", language: "da", now: new Date(NOW).toISOString(), sources, provider: adapter(async () => Response.json(envelope(result))) });
  assert.equal((await execute(analysis)).status, "ready");
  const invalid = [
    { ...analysis, evidenceIds: ["invented"] }, { ...analysis, evidenceIds: [] },
    { ...analysis, claimMode: "causal", causalBasis: { studyId: "fake", classification: "causal", reviewed: true } },
    { ...analysis, pointOfView: "The campaign caused an increase." },
    { ...analysis, recommendation: "" }, { ...analysis, uncertainty: "not an array" },
  ];
  for (const [index, value] of invalid.entries()) await t.test(String(index), async () => {
    assert.equal((await execute(value)).status, "needs_context");
  });
  assert.equal(getProductionSynthesisProvider(), undefined, "shipping a transport must not enable paid calls");
});
