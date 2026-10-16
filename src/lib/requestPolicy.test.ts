import assert from "node:assert/strict";
import test from "node:test";
import { sameOriginWrite } from "./requestPolicy.ts";

test("cookie-authenticated writes require the exact owned origin", () => {
  assert.equal(sameOriginWrite("https://research.example", "https://research.example/api/projects"), true);
  assert.equal(sameOriginWrite("https://research.example", "http://internal:3000/api/projects", "https://research.example"), true);
  for (const origin of [null, "null", "https://sibling.example", "https://research.example.evil", "http://research.example", "https://research.example/path", "https://user@research.example", "https://research.example:8443"]) assert.equal(sameOriginWrite(origin, "https://research.example/api/projects"), false);
  assert.equal(sameOriginWrite("https://research.example", "http://internal:3000", "malformed"), false);
});
