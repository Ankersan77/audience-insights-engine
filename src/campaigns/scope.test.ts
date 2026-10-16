import assert from "node:assert/strict";
import test from "node:test";
import { campaignScopesFromText, parseCampaignScopes, resolveCampaignScope, sameCampaignScopes } from "./scope.ts";

test("campaign scope parsing is bounded, exact and does not infer Cartesian products", () => {
  const scopes = campaignScopesFromText("SE/sv, DK/da\nDE/de-DE");
  assert.deepEqual(scopes.map((scope) => scope.market), ["DE", "DK", "SE"]);
  assert.deepEqual(resolveCampaignScope(scopes, "SE", "sv"), { market: "SE", language: "sv" });
  for (const input of [undefined, [], {}, [{ market: "DK", language: "da", clientId: 2 }], [{ market: "DK", language: "da/x" }], Array(21).fill({ market: "DK", language: "da" }), Array(2).fill({ market: "DK", language: "da" })]) assert.throws(() => parseCampaignScopes(input));
  assert.throws(() => resolveCampaignScope(scopes));
  assert.throws(() => resolveCampaignScope(scopes, "DK", "sv"));
  assert.throws(() => resolveCampaignScope(undefined, "DK", "da"));
  assert.deepEqual(resolveCampaignScope([{ market: "DK", language: "da" }]), { market: "DK", language: "da" });
  assert.equal(sameCampaignScopes(scopes, [...scopes].reverse()), true);
  assert.equal(sameCampaignScopes(undefined, undefined), false);
});
