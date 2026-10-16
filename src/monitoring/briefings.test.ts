import assert from "node:assert/strict";
import test from "node:test";
import { validateSolutionProfile } from "../core/validation.ts";
import { buildPeriodicBriefing, briefingKey, dueBriefingWindows, type BriefingInputs } from "./briefings.ts";

function input(): BriefingInputs {
  return {
    profile: { id: "1", clientId: "a", version: 2, status: "active", enabledAbilities: [{ id: "market-category-diagnosis", version: "1.0.0" }], providerBindings: { statistics: "statistics" }, markets: ["DK"], languages: ["da"], reviewRoles: { briefing: ["reviewer"] }, retention: { evidenceDays: 365, rawHours: 0, auditDays: 365 }, sensingProfileId: "1", briefingCadences: ["weekly", "monthly", "quarterly"], createdAt: "2026-01-01T00:00:00.000Z" },
    cadence: "weekly", window: { start: "2026-10-05T00:00:00.000Z", end: "2026-10-12T00:00:00.000Z" }, now: "2026-10-12T01:00:00.000Z",
    sourceIds: [1], unavailableSourceCount: 0,
    receipts: [{ clientId: "a", sourceId: 1, completedAt: "2026-10-11T00:00:00.000Z", status: "succeeded" }],
    runs: [{ id: 1, clientId: "a", finishedAt: "2026-10-11T00:00:00.000Z", outcome: "no_material_change", signalIds: [] }],
    briefs: [], records: [], campaigns: [], usableEvidenceIds: new Set([1]),
  };
}

test("briefing windows are closed UTC calendar periods with bounded restart catch-up", () => {
  assert.deepEqual(dueBriefingWindows("weekly", "2026-10-09T12:00:00Z", "2026-10-11T23:59:59Z"), []);
  assert.deepEqual(dueBriefingWindows("weekly", "2026-10-09T12:00:00Z", "2026-10-19T00:00:00Z"), [
    { start: "2026-10-09T12:00:00.000Z", end: "2026-10-12T00:00:00.000Z" },
    { start: "2026-10-12T00:00:00.000Z", end: "2026-10-19T00:00:00.000Z" },
  ]);
  assert.deepEqual(dueBriefingWindows("monthly", "2024-02-29T12:00:00Z", "2024-03-01T00:00:00Z"), [{ start: "2024-02-29T12:00:00.000Z", end: "2024-03-01T00:00:00.000Z" }]);
  const quarter = dueBriefingWindows("quarterly", "2025-12-31T00:00:00Z", "2026-04-01T00:00:00Z");
  assert.equal(quarter.length, 2);
  assert.equal(quarter[1].end, "2026-04-01T00:00:00.000Z");
  const batch = dueBriefingWindows("weekly", "2020-01-01T00:00:00Z", "2026-10-16T00:00:00Z", 1000);
  assert.equal(batch.length, 12);
  const next = dueBriefingWindows("weekly", batch.at(-1)!.end, "2026-10-16T00:00:00Z");
  assert.equal(next[0].start, batch.at(-1)!.end);
  assert.notEqual(briefingKey("1", "weekly", batch[0]), briefingKey("2", "weekly", batch[0]));
  assert.throws(() => dueBriefingWindows("weekly", "invalid", "2026-10-16"), /invalid-briefing-window/);
});

test("briefing configuration is opt-in, bounded and requires sensing", () => {
  const profile = input().profile;
  assert.equal(validateSolutionProfile(profile).valid, true);
  assert.equal(validateSolutionProfile({ ...profile, briefingCadences: undefined, sensingProfileId: undefined }).valid, true);
  assert.equal(validateSolutionProfile({ ...profile, sensingProfileId: undefined }).valid, false);
  assert.equal(validateSolutionProfile({ ...profile, briefingCadences: ["weekly", "weekly"] }).valid, false);
});

test("no-change requires both source receipts and completed monitoring, never silence", () => {
  const base = input();
  assert.equal(buildPeriodicBriefing(base).outcome, "no_material_change");
  for (const variation of [
    { receipts: [] }, { runs: [] }, { sourceIds: [] }, { unavailableSourceCount: 1 },
    { receipts: [{ ...base.receipts[0], clientId: "b" }] },
    { receipts: [{ ...base.receipts[0], completedAt: base.window.end }] },
    { runs: [{ ...base.runs[0], outcome: "awaiting_acquisition" }] },
    { runs: [{ ...base.runs[0], outcome: "source_health_failure" }] },
  ]) assert.equal(buildPeriodicBriefing({ ...base, ...variation }).outcome, "needs_context");
});

test("signals retain candidate status and only usable scoped references enter a packet", () => {
  const base = input();
  base.runs = [{ ...base.runs[0], outcome: "signals_qualified", signalIds: [1] }];
  const record = { id: 1, clientId: "a", kind: "signal", reviewState: "pending", lifecycle: "candidate", evidenceIds: [1], contradictionIds: [2], createdAt: "2026-10-11T00:00:00.000Z", applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] } };
  base.records = [record, { ...record, id: 2, clientId: "b" }];
  const packet = buildPeriodicBriefing(base);
  assert.equal(packet.outcome, "review_required");
  assert.deepEqual(packet.references, [{ id: 1, kind: "signal", status: "pending", evidenceIds: [1] }]);
  assert.deepEqual(packet.evidenceIds, [1]);
  assert.deepEqual(packet.contradictions, []);
  for (const variation of [{ usableEvidenceIds: new Set<number>() }, { records: [{ ...record, decayAt: base.now }] }, { records: [{ ...record, applicability: { ...record.applicability, markets: ["SE"] } }] }]) {
    const result = buildPeriodicBriefing({ ...base, ...variation });
    assert.equal(result.outcome, "needs_context");
    assert.equal(result.references.length, 0);
  }
});

test("monthly review requires audience and positioning work; quarterly exposes decay and research backlog", () => {
  const base = input();
  const monthly = { ...base, cadence: "monthly" as const };
  assert.equal(buildPeriodicBriefing(monthly).outcome, "needs_context");
  monthly.briefs = ["audience-purchase-behavior", "brand-positioning-diagnosis"].map((abilityId, index) => ({ clientId: "a", id: index + 1, createdAt: "2026-10-11T00:00:00.000Z", status: "ready", abilityId, evidenceIds: [1], markets: ["DK"], languages: ["da"] }));
  monthly.campaigns = [{ id: 1, clientId: "a", state: "active" }, { id: 2, clientId: "b", state: "active" }];
  const result = buildPeriodicBriefing(monthly);
  assert.equal(result.outcome, "review_required");
  assert.equal(result.references.filter((item) => item.kind === "campaign").length, 1);
  const record = { id: 1, clientId: "a", kind: "fact", reviewState: "accepted", lifecycle: "live", evidenceIds: [1], contradictionIds: [2], createdAt: "2026-10-01T00:00:00.000Z", applicability: { markets: ["DK"], languages: ["da"], categories: [], audiences: [], campaigns: [] } };
  const quarterly = buildPeriodicBriefing({ ...base, cadence: "quarterly", records: [record, { ...record, id: 2, kind: "learning", reviewState: "pending" }, { ...record, id: 3, decayAt: base.now }] });
  assert.equal(quarterly.outcome, "review_required");
  assert.deepEqual(quarterly.references.map((item) => item.status), ["fact:accepted", "learning:pending", "stale_or_unsupported"]);
  assert.deepEqual(quarterly.references.at(-1)?.evidenceIds, []);
  assert.ok(quarterly.contradictions.some((item) => item.recordId === 1 && item.contradictsId === 2));
});
