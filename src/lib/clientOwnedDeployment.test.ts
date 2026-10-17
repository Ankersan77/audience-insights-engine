import assert from "node:assert/strict";
import test from "node:test";
import { validateClientOwnedDeployment } from "./deploymentScope.ts";

const environment = { DATABASE_URL: "postgresql://synthetic.invalid/example", MARKET_RESEARCH_CLIENT_ID: "7", MARKET_RESEARCH_CLIENT_SLUG: "d4wn" };
const d4wn = { id: 7, slug: "d4wn" };

test("client-owned deployment requires exact single database client and pinned identity", () => {
  assert.doesNotThrow(() => validateClientOwnedDeployment(environment, [d4wn]));
  for (const rows of [[], [d4wn, { id: 8, slug: "other" }], [{ id: 8, slug: "d4wn" }], [{ id: 7, slug: "other" }]])
    assert.throws(() => validateClientOwnedDeployment(environment, rows), /client-owned-database-scope-invalid/);
  for (const patch of [{ MARKET_RESEARCH_CLIENT_ID: "" }, { MARKET_RESEARCH_CLIENT_ID: "01" }, { MARKET_RESEARCH_CLIENT_SLUG: "" }, { DATABASE_URL: "" }])
    assert.throws(() => validateClientOwnedDeployment({ ...environment, ...patch }, [d4wn]), /client-owned-deployment-configuration-invalid/);
});
