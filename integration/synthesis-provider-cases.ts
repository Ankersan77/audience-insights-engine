import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { eq } from "drizzle-orm";
import { appUser, canonicalEvidence, clientMembership, externalValidationGate, governanceAudit, intelligenceRecord, sourceConnection, synthesisAuthorization } from "../src/db/schema";
import type { SynthesisDeploymentBinding } from "../src/connectors/synthesisConfiguration";
import type { ResearchSynthesisInput } from "../src/abilities/synthesis";
import { startTestHttpServer } from "./http-server";

type Fixture = { tenant: { id: number; slug: string }; source: { id: number; connectorId: string };
  input: Parameters<typeof import("../src/db/queries/canonical_evidence").persistAcquisition>[0] };

export async function runSynthesisProviderCases(t: TestContext, db: typeof import("../src/db/client").db, probe: Pool, fixtures: () => Promise<{ first: Fixture; second: Fixture }>) {
  const { getProductionSynthesisProvider } = await import("../src/lib/productionSynthesis");
  const { synthesisApprovalScope } = await import("../src/db/queries/synthesis_authority");
  const { setSynthesisBudget, inspectSynthesisBudget } = await import("../src/db/queries/synthesis_budget");
  const { persistAcquisition } = await import("../src/db/queries/canonical_evidence");
  const { createActiveSolutionProfile } = await import("../src/db/queries/solution_profiles");
  const { loadResearchContextSources } = await import("../src/db/queries/research_context");
  const { runContextualResearch } = await import("../src/abilities/synthesis");
  const { saveDecisionBrief } = await import("../src/db/queries/workspace_intelligence");
  const { createAuthSession } = await import("../src/db/queries/auth_sessions");

  await t.test("production synthesis composes source/acceptance checks, budget and actual adapter without implicit activation", async () => {
    const { first, second } = await fixtures();
    const clientId = first.tenant.id;
    const one = await persistAcquisition(first.input); const two = await persistAcquisition(second.input);
    const evidenceIds = [...one.evidenceIds, ...two.evidenceIds].map(String);
    const [user] = await db.insert(appUser).values({ email: "synthesis-reviewer@example.invalid", name: "Synthetic reviewer", role: "researcher", ssoSubjectId: randomUUID() }).returning();
    const [record] = await db.insert(intelligenceRecord).values({ clientId, kind: "fact", title: "Reviewed context", statement: "Prioritize a bounded category study.", lifecycle: "live", reviewState: "accepted",
      evidenceIds: [...one.evidenceIds], contradictionIds: [], dependencyIds: [], applicabilityJson: first.input.applicability,
      confidence: 0.8, uncertainty: ["Synthetic only."], synthesisBy: "human", reviewedBy: user.id, reviewedAt: new Date() }).returning();
    await createActiveSolutionProfile({ clientId, createdBy: user.id, profile: { enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }],
      providerBindings: { first: first.source.connectorId, second: second.source.connectorId }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] }, retention: { evidenceDays: 30, rawHours: 0, auditDays: 365 } } });
    const sources = await loadResearchContextSources({ clientId });
    const analysis = { pointOfView: "The category merits a bounded study.", clientRelevance: "Supports the current decision.", recommendation: "Validate with independent research.", nextDecision: "Choose the study scope.", claimMode: "descriptive", evidenceIds, contradictions: [], uncertainty: ["Synthetic descriptive evidence only."] };
    let captured!: ResearchSynthesisInput;
    const run = (provider: ReturnType<typeof getProductionSynthesisProvider>) => runContextualResearch({ clientId: String(clientId), abilityId: "market-category-diagnosis", question: "What research should follow?", market: "DK", language: "da", sources, now: new Date().toISOString(), provider });
    await run({ id: "capture", version: "1", async synthesize(input) { captured = input; return analysis; } });
    assert.ok(captured);
    const binding: SynthesisDeploymentBinding = { clientId: String(clientId), adapterId: "openai-responses", model: "explicit-test-model", abilityIds: ["market-category-diagnosis"],
      markets: ["DK"], languages: ["da"], allowedSourceClasses: ["official_or_public"], approvalReference: "test:processing", qualityApprovalReference: "test:quality",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), retention: "standard_api_store_false", maxInputBytes: 100_000, maxOutputTokens: 2000, maxResponseBytes: 100_000, timeoutMs: 10_000,
      sourceConnectionIds: [String(first.source.id), String(second.source.id)], currency: "DKK", maxCostMicros: 50, credentialEnv: `MARKET_RESEARCH_MODEL_KEY_CLIENT_${clientId}_SYNTHETIC` };
    const raw = () => JSON.stringify({ schemaVersion: 1, bindings: [binding] });
    let credentialReads = 0; let calls = 0; let duringCall: (() => Promise<void>) | undefined;
    const env: Record<string, string | undefined> = { MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON: raw(), ENABLE_ENV_CREDENTIAL_RESOLVER: "true", MARKET_RESEARCH_CLIENT_ID: String(clientId) };
    Object.defineProperty(env, binding.credentialEnv, { get() { credentialReads++; return "synthetic-not-a-real-key"; } });
    const provider = () => getProductionSynthesisProvider(clientId, { environment: () => env, transport: async (url, options) => {
      calls++; assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(new Headers(options?.headers).get("authorization"), "Bearer synthetic-not-a-real-key");
      const rows = await db.select().from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, clientId));
      assert.ok(rows.some((row) => row.status === "dispatched"));
      await duringCall?.();
      return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(analysis) }] }] });
    } });
    assert.equal(getProductionSynthesisProvider(clientId, { environment: () => ({}) }), undefined);
    assert.equal(getProductionSynthesisProvider(clientId, { environment: () => ({ MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON: "invalid" }) }), undefined);
    assert.equal(getProductionSynthesisProvider(clientId + 1, { environment: () => env }), undefined);
    assert.equal((await run(provider())).status, "needs_context", "no implicit spending allowance");
    await setSynthesisBudget(first.tenant.slug, { currency: "DKK", dailyCostMicros: 2000, dailyRequests: 40, enabled: true });
    assert.equal((await run(provider())).status, "needs_context", "budget is not acceptance");
    assert.equal(credentialReads, 0); assert.equal(calls, 0);
    assert.equal((await inspectSynthesisBudget(first.tenant.slug)).usage.authorizedRequests, "0");
    const gates = await db.insert(externalValidationGate).values([
      { clientId, gateKey: "live_connectors", evidenceReference: binding.approvalReference },
      { clientId, gateKey: "research_quality", evidenceReference: binding.qualityApprovalReference },
    ].map((gate) => ({ ...gate, status: "verified", scope: synthesisApprovalScope(binding), owner: "Synthetic reviewer", verifiedBy: user.id, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }))).returning();
    const ready = await run(provider()); assert.equal(ready.status, "ready", JSON.stringify(ready.researchGaps));
    assert.equal(calls, 1); assert.equal(credentialReads, 1);
    assert.equal((await saveDecisionBrief({ clientId, brief: ready, createdBy: user.id })).brief.status, "ready");

    // Old in-memory evidence must not bypass current source rights or reviewed context.
    await db.update(sourceConnection).set({ rightsJson: { ...first.input.rights, commercialUse: false } }).where(eq(sourceConnection.id, first.source.id));
    await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
    await db.update(sourceConnection).set({ rightsJson: first.input.rights }).where(eq(sourceConnection.id, first.source.id));
    await db.update(intelligenceRecord).set({ statement: "Changed reviewed context." }).where(eq(intelligenceRecord.id, record.id));
    await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
    await db.update(intelligenceRecord).set({ statement: record.statement }).where(eq(intelligenceRecord.id, record.id));
    const [originalEvidence] = await db.select().from(canonicalEvidence).where(eq(canonicalEvidence.id, one.evidenceIds[0]));
    await db.update(canonicalEvidence).set({ methodJson: { method: "Changed universe", limitations: [] } }).where(eq(canonicalEvidence.id, originalEvidence.id));
    await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
    await db.update(canonicalEvidence).set({ methodJson: originalEvidence.methodJson }).where(eq(canonicalEvidence.id, originalEvidence.id));
    for (const patch of [{ status: "needs_context" }, { expiresAt: new Date(0) }, { scope: "wrong-model-or-client" }, { evidenceReference: "wrong-acceptance" }]) {
      await db.update(externalValidationGate).set(patch).where(eq(externalValidationGate.id, gates[0].id));
      await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
      await db.update(externalValidationGate).set({ status: "verified", expiresAt: gates[0].expiresAt, scope: gates[0].scope, evidenceReference: gates[0].evidenceReference }).where(eq(externalValidationGate.id, gates[0].id));
    }
    assert.equal(calls, 1); assert.equal(credentialReads, 1);

    // A valid approval for a smaller source inventory still cannot send an unapproved source.
    const originalSources = binding.sourceConnectionIds;
    binding.sourceConnectionIds = [String(first.source.id)]; env.MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON = raw();
    await db.update(externalValidationGate).set({ scope: synthesisApprovalScope(binding) }).where(eq(externalValidationGate.clientId, clientId));
    await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
    binding.sourceConnectionIds = originalSources; env.MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON = raw();
    await db.update(externalValidationGate).set({ scope: synthesisApprovalScope(binding) }).where(eq(externalValidationGate.clientId, clientId));
    const oldProvider = provider()!;
    env.MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON = "";
    await assert.rejects(oldProvider.synthesize(captured), /governed-synthesis-unavailable/);
    env.MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON = raw();
    assert.equal(calls, 1); assert.equal(credentialReads, 1);

    // Revocation during the mocked network call must finish unknown, not release its answer.
    duringCall = async () => { await db.update(externalValidationGate).set({ status: "needs_context" }).where(eq(externalValidationGate.id, gates[0].id)); };
    await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
    assert.equal(calls, 2); assert.equal(credentialReads, 2);
    assert.equal((await inspectSynthesisBudget(first.tenant.slug)).usage.unknownAttempts, "1");
    await db.update(externalValidationGate).set({ status: "verified" }).where(eq(externalValidationGate.id, gates[0].id));
    duringCall = async () => { env.MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON = ""; };
    await assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
    env.MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON = raw(); duringCall = undefined;
    assert.equal((await inspectSynthesisBudget(first.tenant.slug)).usage.unknownAttempts, "2");

    const editor = await probe.connect();
    try {
      await editor.query("begin");
      await editor.query("update external_validation_gate set status = 'needs_context' where id = $1", [gates[0].id]);
      const pending = assert.rejects(provider()!.synthesize(captured), /governed-synthesis-unavailable/);
      const until = Date.now() + 5000;
      while (true) {
        const blocked = await probe.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0");
        if (blocked.rows[0].n) break;
        if (Date.now() > until) throw new Error("Expected synthesis gate lock contention");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await editor.query("commit"); await pending;
      assert.equal(calls, 3); assert.equal(credentialReads, 3);
    } finally { await editor.query("rollback"); editor.release(); }
    const audits = await db.select().from(governanceAudit).where(eq(governanceAudit.clientId, clientId));
    assert.ok(!JSON.stringify(audits).includes("synthetic-not-a-real-key"));
    assert.ok(!JSON.stringify(audits).includes(analysis.pointOfView));

    if (process.env.TEST_HTTP === "1") {
      await db.insert(clientMembership).values({ clientId, userId: user.id, role: "researcher" });
      const token = await createAuthSession(user.id, clientId);
      const server = await startTestHttpServer(process.env.TEST_DATABASE_URL!);
      try {
        const response = await server.request("/api/workspace/briefs", token, { abilityId: "market-category-diagnosis", question: "Synthetic request with no deployment binding", evidenceIds,
          market: "DK", language: "da", provider: binding, apiKey: "ignored-request-value" });
        assert.equal(response.status, 201);
        const result = await response.json(); assert.equal(result.artifact.brief.status, "needs_context");
        assert.ok(result.artifact.brief.researchGaps.includes("No research synthesis provider is configured."));
        assert.ok(!JSON.stringify(result).includes("ignored-request-value"));
      } finally { await server.stop(); }
    }
  });
}
