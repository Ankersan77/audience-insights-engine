import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { decodeFlowCookie, encodeFlowCookie, FLOW_MAX_AGE_SECONDS, newSessionToken, safeReturnPath, sessionTokenHash } from "./authTokens.ts";

const secret = "synthetic-unit-signing-key-not-for-production";
const now = Date.parse("2026-10-16T12:00:00Z");
const flow = { state: "random-state", nonce: "random-nonce", codeVerifier: "random-pkce-verifier", returnTo: "/projects?view=active" };
test("session cookies are opaque random tokens; only hashes are suitable for storage", () => {
  const tokens = new Set(Array.from({ length: 100 }, newSessionToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) { assert.match(token, /^s1_[A-Za-z0-9_-]{43}$/); assert.equal(sessionTokenHash(token)?.length, 64); assert.notEqual(sessionTokenHash(token), token); }
  for (const token of [undefined, "", "old.signed.cookie", newSessionToken() + ".suffix", "s1_short"]) assert.equal(sessionTokenHash(token), null);
});

test("OIDC flow cookies enforce server-side expiry, purpose, shape and exact signatures", () => {
  const token = encodeFlowCookie(flow, secret, now);
  assert.deepEqual(decodeFlowCookie(token, secret, now), flow);
  assert.deepEqual(decodeFlowCookie(token, secret, now + FLOW_MAX_AGE_SECONDS * 1000 - 1), flow);
  assert.equal(decodeFlowCookie(token, secret, now + FLOW_MAX_AGE_SECONDS * 1000), null);
  assert.equal(decodeFlowCookie(token, secret, now - 1000), null);
  assert.equal(decodeFlowCookie(token + ".extra", secret, now), null);
  assert.equal(decodeFlowCookie(token, secret + "different", now), null);
  const signed = (value: unknown) => { const payload = Buffer.from(JSON.stringify(value)).toString("base64url"); return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`; };
  for (const value of [null, [], flow, { ...flow, purpose: "session", version: 1 }, { ...flow, purpose: "oidc-flow", version: 1, issuedAt: now / 1000, expiresAt: now / 1000 + 99999 }]) assert.equal(decodeFlowCookie(signed(value), secret, now), null);
  assert.throws(() => encodeFlowCookie(flow, "short", now), /at least 32/);
});

test("post-login redirects remain local even with a valid signed flow", () => {
  for (const value of ["https://example.org", "//example.org", "/\\example.org", "/\n/example.org", "javascript:alert(1)", null]) {
    assert.equal(safeReturnPath(value), "/projects");
  }
  const token = encodeFlowCookie({ ...flow, returnTo: "//example.org" }, secret, now);
  assert.equal(decodeFlowCookie(token, secret, now)?.returnTo, "/projects");
});
