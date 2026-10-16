import assert from "node:assert/strict";
import test from "node:test";
import { amountToMicros, budgetCount, formatMicros, parseBudgetEdit } from "./budgetAdministration.ts";

const edit = () => ({ kind: "synthesis", expectedVersion: null, confirmed: true, policy: { currency: "DKK", dailyCostMicros: 0, dailyRequests: 5, enabled: false } });
test("budget edits require explicit limits, version and confirmation and cannot supply authority", () => {
  const input = edit(); const parsed = parseBudgetEdit(input); input.policy.enabled = true;
  assert.equal(parsed.policy.enabled, false);
  assert.equal(parseBudgetEdit({ ...edit(), kind: "acquisition", expectedVersion: 1, policy: { ...edit().policy, dailyRecords: 10 } }).expectedVersion, 1);
  for (const invalid of [null, [], {}, { ...edit(), confirmed: false }, { ...edit(), expectedVersion: undefined }, { ...edit(), expectedVersion: 0 },
    { ...edit(), expectedVersion: "1" }, { ...edit(), expectedVersion: 1.1 }, { ...edit(), kind: "reset" },
    ...["clientId", "actorUserId", "sessionHash", "usage", "credentialEnv", "apiKey"].map((key) => ({ ...edit(), [key]: "injected" })),
    ...[{ dailyCostMicros: -1 }, { dailyRequests: 1.1 }, { currency: "dkk" }, { enabled: "false" }, { dailyRecords: 4 }, { key: "secret" }, { dailyCostMicros: Number.MAX_SAFE_INTEGER + 1 }].map((patch) => ({ ...edit(), policy: { ...edit().policy, ...patch } })),
    { ...edit(), kind: "acquisition" },
  ]) assert.throws(() => parseBudgetEdit(invalid), /budget-invalid-edit/);
});

test("currency amounts round-trip exactly without rounding, exponent coercion or unsafe integers", () => {
  for (const [amount, micros] of [["0", 0], ["0.000001", 1], ["0.1", 100000], ["12.345678", 12345678], ["9007199254.740991", Number.MAX_SAFE_INTEGER]] as const) {
    assert.equal(amountToMicros(amount), micros); assert.equal(formatMicros(micros), amount);
  }
  assert.equal(formatMicros("9007199254740991000"), "9007199254740.991");
  for (const invalid of ["", "-1", "1e3", "1,5", " 1", "1.", ".5", "Infinity", "0.0000001", "9007199254.740992"]) assert.throws(() => amountToMicros(invalid));
  assert.equal(budgetCount("0"), 0); assert.equal(budgetCount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const invalid of ["", "-1", "0.5", "1e2", "Infinity", "9007199254740992"]) assert.throws(() => budgetCount(invalid));
});
