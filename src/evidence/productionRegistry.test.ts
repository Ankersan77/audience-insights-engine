import assert from "node:assert/strict";
import test from "node:test";
import { createProductionRuntimeContext } from "./productionRegistry.ts";

test("production credential resolver accepts only this installation's source key namespace", async () => {
  const names = ["ENABLE_ENV_CREDENTIAL_RESOLVER", "MARKET_RESEARCH_CLIENT_ID", "MARKET_RESEARCH_SOURCE_KEY_CLIENT_7_FORUM"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.ENABLE_ENV_CREDENTIAL_RESOLVER = "true";
    process.env.MARKET_RESEARCH_CLIENT_ID = "7";
    process.env.MARKET_RESEARCH_SOURCE_KEY_CLIENT_7_FORUM = "synthetic-secret";
    const runtime = createProductionRuntimeContext();
    assert.equal(await runtime.resolveCredential({ provider: "secret-store", key: "env:MARKET_RESEARCH_SOURCE_KEY_CLIENT_7_FORUM" }), "synthetic-secret");
    for (const key of ["env:DATABASE_URL", "env:OPENAI_API_KEY", "env:MARKET_RESEARCH_SOURCE_KEY_CLIENT_8_FORUM", "env:MARKET_RESEARCH_MODEL_KEY_CLIENT_7_OPENAI"])
      await assert.rejects(runtime.resolveCredential({ provider: "secret-store", key }), /credential-reference-out-of-scope/);
    delete process.env.MARKET_RESEARCH_CLIENT_ID;
    await assert.rejects(runtime.resolveCredential({ provider: "secret-store", key: "env:MARKET_RESEARCH_SOURCE_KEY_CLIENT_7_FORUM" }), /deployment-client-id-required/);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
