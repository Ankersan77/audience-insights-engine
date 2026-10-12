#!/usr/bin/env node
// Thin wrapper around Node's built-in test runner (`node --test`), the
// lowest-dependency test runner available (no test framework is otherwise
// configured in this project — T26).
//
// `verify.sh` (the shared epic gate) invokes `npm run --silent test -- --run`,
// mirroring the `--run` flag most JS test runners (e.g. vitest) use for a
// single non-watch pass. Node's own test runner has no such flag, and `--run`
// collides with Node's own `--run <script>` CLI flag, which errors
// ("--run requires an argument") if passed through bare. This wrapper strips
// a trailing `--run` before forwarding everything else — including an
// explicit file path, e.g. `pnpm test src/lib/rillAllowlist.test.ts` — to
// `node --test`.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--run");

const result = spawnSync(process.execPath, ["--test", ...args], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
