import assert from "node:assert/strict";
import test from "node:test";
import { legacyLast30DaysEnabled } from "./featureFlags.ts";

test("legacy Last30Days ingestion is fail-closed", () => {
  assert.equal(legacyLast30DaysEnabled(undefined), false);
  assert.equal(legacyLast30DaysEnabled(""), false);
  assert.equal(legacyLast30DaysEnabled("false"), false);
  assert.equal(legacyLast30DaysEnabled("1"), false);
  assert.equal(legacyLast30DaysEnabled("TRUE"), true);
});

