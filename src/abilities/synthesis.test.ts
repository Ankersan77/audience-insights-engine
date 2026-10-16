import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceItem, IntelligenceRecord } from "../core/contracts.ts";
import { prepareResearchContext, type ResearchContextSources } from "./context.ts";
import { runAbilityWithSynthesis, runContextualResearch, type ResearchSynthesisProvider } from "./synthesis.ts";

function evidence(id: string, sourceConnectionId: string): EvidenceItem {
  return {
    id, clientId: "client-a", collectionId: `collection-${id}`, sourceConnectionId, sourceClass: "official_or_public",
    externalReference: `source:${id}`, sourceContent: `Governed evidence ${id}`, synthesis: `Evidence ${id}`,
    ingestedAt: "2026-10-16T00:00:00.000Z", expiresAt: "2027-10-16T00:00:00.000Z", lifecycle: "live", citationLevel: "paraphrased",
    rights: { basis: "public_permitted", commercialUse: true, quotationAllowed: false, restrictions: [] },
    method: { method: "official publication", limitations: [] }, applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] },
    confidence: 0.8, grade: "A", sensitive: false, identityRisk: false, redactions: [], contentHash: `hash-${id}`,
  };
}

test("a synthesis provider proposes analysis only after deterministic evidence selection", async () => {
  let receivedIds: readonly string[] = [];
  const provider: ResearchSynthesisProvider = { id: "fixture", version: "1", async synthesize(input) {
    receivedIds = input.evidence.map((item) => item.id);
    return { pointOfView: "The governed sources indicate a material category change.", clientRelevance: "The decision concerns the Danish market.", recommendation: "Validate the response against the current brand law.", nextDecision: "Choose whether to commission the next bounded study.", claimMode: "descriptive", evidenceIds: receivedIds, contradictions: [], uncertainty: ["Descriptive evidence only."] };
  } };
  const result = await runAbilityWithSynthesis({ clientId: "client-a", abilityId: "market-category-diagnosis", question: "What changed?", evidence: [evidence("one", "source-1"), evidence("two", "source-2")], market: "DK", language: "da", now: "2026-10-16T00:00:00.000Z", provider });
  assert.equal(result.status, "ready");
  assert.deepEqual([...receivedIds].sort(), ["one", "two"]);
});

test("missing evidence bypasses synthesis and remains needs context", async () => {
  let called = false;
  const provider: ResearchSynthesisProvider = { id: "fixture", version: "1", async synthesize() { called = true; throw new Error("must-not-run"); } };
  const result = await runAbilityWithSynthesis({ clientId: "client-a", abilityId: "market-category-diagnosis", question: "What changed?", evidence: [], now: "2026-10-16T00:00:00.000Z", provider });
  assert.equal(result.status, "needs_context");
  assert.equal(called, false);
});

const now = "2026-10-16T00:00:00.000Z";
const request = { clientId: "client-a", abilityId: "market-category-diagnosis", question: "Which category should we prioritize?", projectId: "project-1", now };
const analysis = { pointOfView: "The category shows a descriptive change.", clientRelevance: "Relevant to the category decision.", recommendation: "Validate with a bounded study.", nextDecision: "Choose the study scope.", claimMode: "descriptive" as const, evidenceIds: ["one", "two"], contradictions: [], uncertainty: ["No causal inference."] };

function contextSources(): ResearchContextSources {
  const brand = { ...evidence("brand", "source-brand"), sourceClass: "client_owned" as const };
  const record: IntelligenceRecord = {
    id: "strategy", clientId: "client-a", kind: "fact", title: "Reviewed brand strategy", statement: "The brand prioritizes accessible quality.",
    lifecycle: "live", reviewState: "accepted", evidenceIds: ["brand"], contradictionIds: ["alternative"], dependencyIds: [],
    applicability: brand.applicability, confidence: 0.8, uncertainty: ["Validate in the next study."], synthesisBy: "human", createdAt: now, reviewedAt: now,
  };
  return {
    project: { id: "project-1", clientId: "client-a", name: "Category choice", decision: "Choose the next category to research.", markets: ["DK"], languages: ["da"], status: "active", createdAt: now, updatedAt: now },
    solution: { id: "solution-1", clientId: "client-a", version: 3, status: "active", enabledAbilities: [{ id: request.abilityId, version: "1.0.0" }],
      providerBindings: { statistics: "official-one", reports: "official-two", brand: "brand" }, markets: ["DK"], languages: ["da"], reviewRoles: { research: ["reviewer"] },
      retention: { evidenceDays: 365, rawHours: 0, auditDays: 365 }, createdAt: now },
    intelligence: [record, { ...record, id: "alternative", statement: "Premium positioning may be relevant in another occasion.", contradictionIds: ["strategy"] }],
    evidence: [evidence("one", "source-1"), evidence("two", "source-2"), brand],
    sourceBindings: { "official-one": "source-1", "official-two": "source-2", brand: "source-brand" },
  };
}

test("contextual synthesis binds project, solution version and reviewed strategy without losing contradictions", async () => {
  const sources = contextSources();
  let calls = 0;
  const provider: ResearchSynthesisProvider = { id: "fixture", version: "2", async synthesize(input) {
    calls++;
    assert.equal(input.context?.project?.decision, sources.project?.decision);
    assert.equal(input.context?.solution.version, 3);
    assert.deepEqual(input.context?.marketTwin.map((record) => record.id), ["alternative", "strategy"]);
    assert.deepEqual(input.evidence.map((item) => item.id).sort(), ["brand", "one", "two"]);
    assert.equal(input.market, "DK");
    return { ...analysis, evidenceIds: ["one", "two", "brand"] };
  } };
  const result = await runContextualResearch({ ...request, sources, provider });
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.contextBasis?.solutionVersion, 3);
  assert.equal(result.contextBasis?.projectId, "project-1");
  assert.equal(result.contextBasis?.intelligence[0].contentDigest.length, 64);
  assert.equal(result.contradictions.length, 2);
  assert.deepEqual(result.synthesisProvider, { id: "fixture", version: "2" });
  assert.ok(!JSON.stringify(result.contextBasis).includes("accessible quality"));
});

test("invalid client, configuration and scope never reach a synthesis provider", async (t) => {
  const variants: [string, (sources: ResearchContextSources) => void][] = [
    ["foreign project", (s) => { s.project = { ...s.project!, clientId: "client-b" }; }],
    ["archived project", (s) => { s.project = { ...s.project!, status: "archived" }; }],
    ["foreign solution", (s) => { s.solution = { ...s.solution!, clientId: "client-b" }; }],
    ["superseded solution", (s) => { s.solution = { ...s.solution!, status: "superseded" }; }],
    ["unapproved ability version", (s) => { s.solution = { ...s.solution!, enabledAbilities: [{ id: request.abilityId, version: "9" }] }; }],
    ["unresolved source binding", (s) => { s.sourceBindings = {}; }],
    ["missing bound sensing", (s) => { s.solution = { ...s.solution!, sensingProfileId: "missing" }; }],
    ["incompatible market", (s) => { s.project = { ...s.project!, markets: ["SE"] }; }],
  ];
  for (const [name, mutate] of variants) await t.test(name, async () => {
    const sources = contextSources(); mutate(sources);
    let calls = 0;
    const result = await runContextualResearch({ ...request, sources, provider: { id: "fixture", version: "1", async synthesize() { calls++; return analysis; } } });
    assert.equal(result.status, "needs_context");
    assert.equal(calls, 0);
  });
  const sources = contextSources();
  sources.solution = { ...sources.solution!, markets: ["DK", "SE"] };
  assert.equal(prepareResearchContext({ ...request, projectId: undefined, sources }).context, undefined);
});

test("Market Twin excludes unreviewed, stale, foreign, unsupported and out-of-scope records", async () => {
  const sources = contextSources();
  const base = sources.intelligence[0];
  sources.intelligence = [base,
    { ...base, id: "pending", reviewState: "pending" },
    { ...base, id: "foreign", clientId: "client-b" },
    { ...base, id: "expired", decayAt: now },
    { ...base, id: "invalid-decay", decayAt: "bad-date" },
    { ...base, id: "unreviewed", reviewedAt: undefined },
    { ...base, id: "unsupported", evidenceIds: ["missing"] },
    { ...base, id: "other-market", applicability: { ...base.applicability, markets: ["SE"] } },
  ];
  const prepared = prepareResearchContext({ ...request, sources });
  assert.deepEqual(prepared.context?.marketTwin.map((record) => record.id), ["strategy"]);
  assert.equal(prepared.basis?.excludedRecordCount, 6);
  for (const expiry of [now, "invalid-date"]) {
    const expired = structuredClone(sources);
    expired.evidence = expired.evidence.map((item) => item.id === "brand" ? { ...item, rights: { ...item.rights, expiresAt: expiry } } : item);
    assert.equal((await runContextualResearch({ ...request, sources: expired, analysis })).status, "needs_context");
  }
});

test("context evidence does not replace the ability's required market evidence", async () => {
  const sources = contextSources();
  sources.evidence = sources.evidence.filter((item) => item.id === "brand");
  const result = await runContextualResearch({ ...request, sources, analysis: { ...analysis, evidenceIds: ["brand"] } });
  assert.equal(result.status, "needs_context");
  assert.ok(result.researchGaps.some((gap) => gap.includes("more independent source")));
});

test("untrusted synthesis cannot invent citations, approve causality or leak provider errors", async (t) => {
  const values: [string, unknown][] = [
    ["missing output", undefined], ["malformed output", { ...analysis, uncertainty: "none" }],
    ["empty citation list", { ...analysis, evidenceIds: [] }],
    ["invented citation", { ...analysis, evidenceIds: ["foreign-evidence"] }],
    ["self-approved causal study", { ...analysis, claimMode: "causal", causalBasis: { studyId: "invented", classification: "causal", reviewed: true } }],
  ];
  for (const [name, value] of values) await t.test(name, async () => {
    const result = await runContextualResearch({ ...request, sources: contextSources(), provider: { id: "fixture", version: "1", async synthesize() { return value; } } });
    assert.equal(result.status, "needs_context");
  });
  const failed = await runContextualResearch({ ...request, sources: contextSources(), provider: { id: "fixture", version: "1", async synthesize() { throw new Error("secret-provider-token"); } } });
  assert.equal(failed.status, "needs_context");
  assert.ok(!JSON.stringify(failed).includes("secret-provider-token"));
  const absent = await runContextualResearch({ ...request, sources: contextSources() });
  assert.equal(absent.status, "needs_context");
  assert.ok(absent.researchGaps.includes("No research synthesis provider is configured."));
});
