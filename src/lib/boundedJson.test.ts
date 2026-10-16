import assert from "node:assert/strict";
import test from "node:test";
import { boundedJson } from "./boundedJson.ts";

test("JSON request limits count actual UTF-8 bytes without trusting headers", async () => {
  const request = (body: string) => new Request("https://example.org", { method: "POST", body, headers: { "content-length": "1" } });
  assert.deepEqual(await boundedJson(request('{"a":"æ"}'), 10), { a: "æ" });
  await assert.rejects(boundedJson(request('{"a":"æ"}'), 9), /too-large/);
  await assert.rejects(boundedJson(request("[invalid]"), 100));
  await assert.rejects(boundedJson(new Request("https://example.org"), 100), /invalid-json-body/);
});
