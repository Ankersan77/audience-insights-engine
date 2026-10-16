import assert from "node:assert/strict";
import test from "node:test";
import { validateSynthesisBudget, validateSynthesisPlan, type SynthesisSpendPlan, type SynthesisSpendLedger, type SynthesisOutcome } from "./synthesisBudget.ts";
import { withSynthesisBudget } from "./governedSynthesis.ts";
import type { ResearchSynthesisInput } from "./synthesis.ts";

function plan(): SynthesisSpendPlan {
  return { currency: "DKK", maxCostMicros: 1000, providerId: "synthetic", providerVersion: "1", model: "fixture-model",
    approvalReference: "acceptance:fixture", bindingExpiresAt: "2099-01-01T00:00:00Z", maxInputBytes: 100_000, maxOutputTokens: 2000, maxDurationMs: 1000 };
}
function input(): ResearchSynthesisInput {
  return { clientId: "1", abilityId: "market-category-diagnosis", question: "Private synthetic question", evidence: [], market: "DK", language: "da",
    context: { clientId: "1", market: "DK", language: "da", marketTwin: [], solution: { id: "s1", version: 1, markets: ["DK"], languages: ["da"], enabledAbilities: [], reviewRoles: {}, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } } };
}
function fixture() {
  const events: string[] = [];
  const ledger: SynthesisSpendLedger = {
    async reserve(attempt) { events.push("reserve"); assert.match(attempt.inputDigest, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(attempt).includes("Private synthetic")); return { clientId: "1", id: "1" }; },
    async dispatch() { events.push("dispatch"); return { expiresAt: new Date(Date.now() + 1000).toISOString() }; },
    async finish(_permit, outcome) { events.push(`finish:${outcome}`); return { accepted: outcome === "succeeded" }; },
  };
  const options = { id: "synthetic", version: "1", ledger, plan,
    async createProvider() { events.push("credentials"); return { id: "synthetic", version: "1", async synthesize() { events.push("request"); return { synthetic: true }; } }; },
  };
  return { events, ledger, options };
}

test("synthesis policy and plan require explicit bounded integer currency limits", () => {
  const valid = { currency: "DKK", dailyCostMicros: 0, dailyRequests: 0, enabled: false };
  validateSynthesisBudget(valid); validateSynthesisPlan(plan());
  for (const patch of [{ dailyCostMicros: -1 }, { dailyCostMicros: Number.MAX_SAFE_INTEGER + 1 }, { dailyRequests: 1.5 }, { enabled: "yes" }, { currency: "dkk" }])
    assert.throws(() => validateSynthesisBudget({ ...valid, ...patch } as typeof valid), /invalid-policy/);
  for (const patch of [{ maxCostMicros: Infinity }, { maxInputBytes: 0 }, { maxOutputTokens: 0 }, { maxDurationMs: 120001 }, { approvalReference: "" }, { bindingExpiresAt: "invalid" }, { model: "model\nsecret" }])
    assert.throws(() => validateSynthesisPlan({ ...plan(), ...patch }), /invalid-plan/);
});

test("durable reserve and single-use dispatch precede credentials, request and result", async () => {
  const f = fixture();
  assert.deepEqual(await withSynthesisBudget(f.options).synthesize(input()), { synthetic: true });
  assert.deepEqual(f.events, ["reserve", "dispatch", "credentials", "request", "finish:succeeded"]);
});

test("failed admission/dispatch never resolves credentials or makes a request", async (t) => {
  for (const step of ["reserve", "dispatch"] as const) await t.test(step, async () => {
    const f = fixture();
    f.ledger[step] = async () => { throw new Error("private database diagnostic"); };
    await assert.rejects(withSynthesisBudget(f.options).synthesize(input()), /^Error: governed-synthesis-unavailable$/);
    assert.ok(!f.events.includes("credentials")); assert.ok(!f.events.includes("request"));
  });
});

test("invalid plan, provider identity, context or oversized input fail before admission", async (t) => {
  for (const [name, patch, request] of [
    ["unknown currency", { currency: "" }, input()],
    ["wrong provider", { providerId: "other" }, input()],
    ["wrong version", { providerVersion: "other" }, input()],
    ["too large", { maxInputBytes: 1024 }, { ...input(), question: "x".repeat(2000) }],
    ["foreign context", {}, { ...input(), clientId: "2" }],
  ] as const) await t.test(name, async () => {
    const f = fixture();
    await assert.rejects(withSynthesisBudget({ ...f.options, plan: () => ({ ...plan(), ...patch }) }).synthesize(request), /governed-synthesis-unavailable/);
    assert.deepEqual(f.events, []);
  });
});

test("unknown outcomes and receipt failures never release output or trigger provider retries", async (t) => {
  for (const cause of ["provider", "receipt", "denied"] as const) await t.test(cause, async () => {
    const f = fixture(); let calls = 0;
    const options = { ...f.options, async createProvider() {
      return { id: "synthetic", version: "1", async synthesize() { calls++; if (cause === "provider") throw new Error("secret-token"); return "private-output"; } };
    } };
    if (cause !== "provider") f.ledger.finish = async (_permit, outcome) => {
      f.events.push(`finish:${outcome}`);
      if (cause === "receipt") throw new Error("database connection lost");
      return { accepted: false };
    };
    await assert.rejects(withSynthesisBudget(options).synthesize(input()), /^Error: governed-synthesis-unavailable$/);
    assert.equal(calls, 1);
    assert.ok(f.events.includes(cause === "denied" ? "finish:succeeded" : "finish:unknown"));
  });
});

test("caller mutations while reserve waits cannot change tenant, request or execution plan", async () => {
  const f = fixture(); const request = input(); const configured = plan();
  let released!: () => void;
  const wait = new Promise<void>((resolve) => { released = resolve; });
  f.ledger.reserve = async () => { await wait; return { clientId: "1", id: "1" }; };
  const work = withSynthesisBudget({ ...f.options, plan: () => configured, async createProvider({ plan: accepted }) {
    assert.equal(accepted.model, "fixture-model");
    return { id: "synthetic", version: "1", async synthesize(received) { assert.equal(received.clientId, "1"); assert.equal(received.question, "Private synthetic question"); return true; } };
  } }).synthesize(request);
  request.clientId = "2"; request.question = "changed"; configured.model = "changed";
  released(); assert.equal(await work, true);
});

test("cancellation before dispatch incurs no credential access, and after dispatch stays unknown", async () => {
  const f = fixture(); const controller = new AbortController();
  f.ledger.reserve = async () => { controller.abort(); return { clientId: "1", id: "1" }; };
  await assert.rejects(withSynthesisBudget({ ...f.options, signal: controller.signal }).synthesize(input()), /governed-synthesis-unavailable/);
  assert.deepEqual(f.events, ["finish:cancelled"]);
  const g = fixture(); const active = new AbortController();
  await assert.rejects(withSynthesisBudget({ ...g.options, signal: active.signal, async createProvider() {
    active.abort(); return { id: "synthetic", version: "1", async synthesize() { assert.fail("must not call"); } };
  } }).synthesize(input()), /governed-synthesis-unavailable/);
  assert.ok(g.events.includes("finish:unknown"));
});

test("timeout bounds a hung factory and late resolution cannot start a request", async () => {
  const f = fixture(); let resolve!: (value: Awaited<ReturnType<typeof f.options.createProvider>>) => void;
  let signal: AbortSignal | undefined;
  const work = withSynthesisBudget({ ...f.options, plan: () => ({ ...plan(), maxDurationMs: 10 }), async createProvider(context) {
    signal = context.signal;
    return new Promise<Awaited<ReturnType<typeof f.options.createProvider>>>((done) => { resolve = done; });
  } }).synthesize(input());
  await assert.rejects(work, /governed-synthesis-unavailable/);
  assert.equal(signal?.aborted, true);
  resolve({ id: "synthetic", version: "1", async synthesize() { assert.fail("late request"); } });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(f.events, ["reserve", "dispatch", "finish:unknown"]);
});

test("late response after timeout cannot overwrite unknown receipt or release output", async () => {
  const f = fixture(); const outcomes: SynthesisOutcome[] = []; let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  f.ledger.finish = async (_permit, outcome) => { outcomes.push(outcome); return { accepted: true }; };
  await assert.rejects(withSynthesisBudget({ ...f.options, plan: () => ({ ...plan(), maxDurationMs: 10 }), async createProvider() {
    return { id: "synthetic", version: "1", async synthesize() { await pending; return "late"; } };
  } }).synthesize(input()), /governed-synthesis-unavailable/);
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(outcomes, ["unknown"]);
});

test("an expired dispatch grant never reaches credentials even when the local duration is longer", async () => {
  const f = fixture();
  f.ledger.dispatch = async () => ({ expiresAt: new Date(Date.now() - 1).toISOString() });
  await assert.rejects(withSynthesisBudget(f.options).synthesize(input()), /governed-synthesis-unavailable/);
  assert.deepEqual(f.events, ["reserve", "finish:unknown"]);
});
