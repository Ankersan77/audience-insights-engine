import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_RILL_MEASURES,
  isAllowed,
  matchesBlockedPattern,
  type RillView,
} from "./rillAllowlist.ts";

test("every currently-known measure and dimension on both allowed views passes isAllowed", () => {
  for (const view of Object.keys(ALLOWED_RILL_MEASURES) as RillView[]) {
    const entry = ALLOWED_RILL_MEASURES[view];
    for (const measure of entry.measures) {
      assert.equal(isAllowed(view, measure), true, `${view}.${measure} (measure) should be allowed`);
    }
    for (const dimension of entry.dimensions) {
      assert.equal(isAllowed(view, dimension), true, `${view}.${dimension} (dimension) should be allowed`);
    }
  }
});

test("a non-allowed view is rejected", () => {
  assert.equal(isAllowed("commercial_revenue", "clicks"), false);
  assert.equal(isAllowed("business_central_revenue", "avg_rank"), false);
});

test("a non-allowed field on an allowed view is rejected", () => {
  assert.equal(isAllowed("organic_search_performance", "commercial_revenue"), false);
  assert.equal(isAllowed("organic_search_performance", "ndc_count"), false);
  assert.equal(isAllowed("playbook_event_stream", "avg_rank"), false);
});

test("a field name containing a blocked pattern is rejected by the pattern filter even if hypothetically allowlisted", () => {
  // These are NOT in ALLOWED_RILL_MEASURES; this tests the pattern filter
  // function directly, independent of the allowlist, per T26's requirement
  // to prove the filter itself — not just queryRill's end-to-end behaviour.
  assert.equal(matchesBlockedPattern("revenue"), true);
  assert.equal(matchesBlockedPattern("total_revenue"), true);
  assert.equal(matchesBlockedPattern("NDC"), true);
  assert.equal(matchesBlockedPattern("commission_rate"), true);
  assert.equal(matchesBlockedPattern("wagering_amount"), true);
  assert.equal(matchesBlockedPattern("deposit_count"), true);
  assert.equal(matchesBlockedPattern("cost"), true);
  assert.equal(matchesBlockedPattern("ad_spend"), true);
  assert.equal(matchesBlockedPattern("ggr"), true);
  assert.equal(matchesBlockedPattern("ngr"), true);
});

test("word-boundary matching: ggr does not falsely match inside aggregated_sessions", () => {
  assert.equal(matchesBlockedPattern("aggregated_sessions"), false);
  assert.equal(matchesBlockedPattern("aggregate"), false);
});

test("allowlisted measures and dimensions do not themselves trip the pattern filter", () => {
  for (const view of Object.keys(ALLOWED_RILL_MEASURES) as RillView[]) {
    const entry = ALLOWED_RILL_MEASURES[view];
    for (const field of [...entry.measures, ...entry.dimensions]) {
      assert.equal(matchesBlockedPattern(field), false, `${view}.${field} should not match the blocked pattern`);
    }
  }
});
