import assert from "node:assert/strict";
import test from "node:test";
import { canResearchRole, canReviewRole, isAdminRole } from "./rolePolicy.ts";

test("runtime permissions separate administration, research, review, and read-only access", () => {
  assert.equal(isAdminRole("owner"), true);
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("researcher"), false);
  assert.equal(canResearchRole("researcher"), true);
  assert.equal(canResearchRole("reviewer"), false);
  assert.equal(canReviewRole("reviewer"), true);
  assert.equal(canReviewRole("researcher"), false);
  assert.equal(canResearchRole("viewer"), false);
  assert.equal(canReviewRole("researcher"), false);
});
