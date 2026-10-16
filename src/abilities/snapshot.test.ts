import assert from "node:assert/strict";
import test from "node:test";
import { researchSnapshotDigest } from "./snapshot.ts";

test("research snapshot digests survive JSONB key order and omit undefined fields", () => {
  const before = { b: [{ z: 1, a: 2 }], a: "value", optional: undefined };
  const roundtrip = { a: "value", b: [{ a: 2, z: 1 }] };
  assert.equal(researchSnapshotDigest(before), researchSnapshotDigest(roundtrip));
  assert.notEqual(researchSnapshotDigest(before), researchSnapshotDigest({ ...roundtrip, a: "changed" }));
  assert.notEqual(researchSnapshotDigest([1, 2]), researchSnapshotDigest([2, 1]));
  assert.notEqual(researchSnapshotDigest({ a: null }), researchSnapshotDigest({}));
});
