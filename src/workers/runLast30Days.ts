/**
 * Worker wrapper around the vendored `last30days` research engine
 * (`vendor/last30days`, pinned git submodule — decisions/0002-last30days-subprocess.md).
 *
 * Invoked as a local child process of the worker, inside the same container
 * image as the Next.js app (ADR 0002) — never over a network interface, never
 * patched in place. The engine's entry point is
 * `vendor/last30days/skills/last30days/scripts/last30days.py`, a Python 3.12+
 * CLI retained for historical compatibility only. The queue gate is permanently
 * closed, and no provider credentials are forwarded to this child process.
 *
 * `child_process.spawn` (not `exec`) is used deliberately: every instruction
 * field becomes its own argv element, so there is no shell to inject into,
 * and stdout/stderr can be streamed and a hard timeout enforced without
 * waiting for a shell wrapper to die too.
 *
 * The child environment is built explicitly (not inherited wholesale) and
 * forces `LAST30DAYS_CONFIG_DIR=""` + `LAST30DAYS_SKIP_KEYCHAIN=1`, so the
 * engine never reads a developer's local `~/.config/last30days/.env` or macOS
 * Keychain — only the credentials this process was explicitly given. This is
 * also what keeps the engine's "first run" setup wizard from ever triggering:
 * that wizard is reached only via the `setup` topic or `--welcome`/`--device-auth`
 * flags, none of which this wrapper ever passes.
 */

import { spawn } from "node:child_process";
import path from "node:path";

/** Hard ceiling before the subprocess is killed and `{ status: "timeout" }` is returned. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Grace period between SIGTERM and SIGKILL on timeout, letting the engine's own
 * SIGTERM handler clean up its descendant processes (bird-search, yt-dlp, digg). */
const KILL_GRACE_MS = 5_000;

export interface RunLast30DaysInstruction {
  subreddits: string[];
  dedicatedSubreddits: string[];
  xHandle: string | null;
  xRelated: string[];
  tiktokHashtags: string[];
  topic: string;
}

export interface RunLast30DaysOptions {
  /** Override the 10-minute default timeout. Milliseconds. */
  timeoutMs?: number;
  /** Override the resolved path to the engine's entry script (tests only). */
  enginePath?: string;
  /** Override the Python interpreter (tests only). Defaults to `python3`. */
  pythonBin?: string;
}

export type RunLast30DaysStatus = "completed" | "timeout" | "spawn-error";

export interface RunLast30DaysResult {
  status: RunLast30DaysStatus;
  /** The compact report text on stdout (unparsed — evidence extraction is a later step). */
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

function resolveEnginePath(enginePath?: string): string {
  return (
    enginePath ??
    path.join(
      process.cwd(),
      "vendor",
      "last30days",
      "skills",
      "last30days",
      "scripts",
      "last30days.py"
    )
  );
}

function commaList(values: string[]): string | null {
  const cleaned = values.map((v) => v.trim()).filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned.join(",") : null;
}

function buildArgs(instruction: RunLast30DaysInstruction, enginePath: string): string[] {
  const args: string[] = [enginePath];

  const topic = instruction.topic.trim();
  if (topic) {
    args.push(topic);
  }

  const subreddits = commaList(instruction.subreddits);
  if (subreddits) {
    args.push("--subreddits", subreddits);
  }

  const dedicatedSubreddits = commaList(instruction.dedicatedSubreddits);
  if (dedicatedSubreddits) {
    args.push("--dedicated-subreddits", dedicatedSubreddits);
  }

  if (instruction.xHandle && instruction.xHandle.trim()) {
    args.push("--x-handle", instruction.xHandle.trim());
  }

  const xRelated = commaList(instruction.xRelated);
  if (xRelated) {
    args.push("--x-related", xRelated);
  }

  const tiktokHashtags = commaList(instruction.tiktokHashtags);
  if (tiktokHashtags) {
    args.push("--tiktok-hashtags", tiktokHashtags);
  }

  args.push("--emit=compact");

  return args;
}

/** Minimal, explicit child environment — see module doc for why this is not `{ ...process.env }`. */
function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {
    // Clean/no-config mode: never read a developer's or host's global
    // ~/.config/last30days/.env — only what this function is given.
    LAST30DAYS_CONFIG_DIR: "",
    // Never probe macOS Keychain for credentials either, for the same reason.
    LAST30DAYS_SKIP_KEYCHAIN: "1",
  };

  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;

  return env;
}

/**
 * Runs the vendored `last30days` engine for one research instruction and
 * returns its compact report on stdout, unparsed. This is not an active
 * acquisition route and receives no provider credentials.
 */
export function runLast30Days(
  instruction: RunLast30DaysInstruction,
  options: RunLast30DaysOptions = {}
): Promise<RunLast30DaysResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const enginePath = resolveEnginePath(options.enginePath);
  const pythonBin = options.pythonBin ?? "python3";
  const args = buildArgs(instruction, enginePath);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn(pythonBin, args, {
      // Deliberately not `NodeJS.ProcessEnv`-shaped by construction (see
      // buildChildEnv's doc comment); `spawn` only needs a string map.
      env: buildChildEnv() as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Resolves the returned promise exactly once. Deliberately does not
    // touch `killTimer`: on a timeout, that timer must keep running
    // independently so a SIGTERM-ignoring process still gets SIGKILLed,
    // even though the promise itself has already settled as "timeout".
    const settlePromise = (status: RunLast30DaysStatus, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve({ status, stdout, stderr, exitCode, durationMs: Date.now() - startedAt });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", () => {
      // e.g. python3 not found / not executable.
      if (killTimer) clearTimeout(killTimer);
      settlePromise("spawn-error", null);
    });

    child.on("close", (code) => {
      // The process actually exited (whether on its own or from the SIGTERM
      // below) — no need to escalate to SIGKILL any more.
      if (killTimer) clearTimeout(killTimer);
      settlePromise("completed", code);
    });

    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, KILL_GRACE_MS);
      // Resolve as timed-out regardless of how the process eventually dies —
      // never silently retried, per tech review required finding 8/9.
      settlePromise("timeout", null);
    }, timeoutMs);
  });
}
