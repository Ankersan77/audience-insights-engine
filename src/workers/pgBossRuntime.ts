import { PgBoss } from "pg-boss";

export type WorkerBoss = PgBoss;
export const WORKER_DATABASE_OPTIONS = "-c statement_timeout=10000 -c lock_timeout=1000";

type RuntimeOptions = {
  connectionString?: string;
  createBoss?: (connectionString: string | undefined, databaseOptions: string) => PgBoss;
  onRuntimeError?: (code: "pg-boss-runtime-error") => void;
};

export function createWorkerRuntimeManager(options: RuntimeOptions = {}) {
  let runtime: Promise<PgBoss> | null = null;
  return {
    get(): Promise<PgBoss> {
      if (!runtime) {
        runtime = (async () => {
          const createBoss = options.createBoss ?? ((connectionString, databaseOptions) => new PgBoss({ connectionString, options: databaseOptions }));
          const boss = createBoss(options.connectionString ?? process.env.DATABASE_URL, WORKER_DATABASE_OPTIONS);
          boss.on("error", () => (options.onRuntimeError ?? ((code) => console.error(`[worker] ${code}`)))("pg-boss-runtime-error"));
          try {
            await boss.start();
          } catch (error) {
            // PgBoss may have opened resources before rejecting startup. Make a
            // bounded cleanup attempt without replacing the original error.
            await boss.stop({ graceful: true, timeout: 5_000 }).catch(() => undefined);
            throw error;
          }
          return boss;
        })().catch((error) => {
          runtime = null;
          throw error;
        });
      }
      return runtime;
    },
  };
}

const sharedRuntime = createWorkerRuntimeManager();

/** One lazily-started, provider-neutral PgBoss lifecycle per process. */
export function getWorkerRuntime(): Promise<PgBoss> {
  return sharedRuntime.get();
}

type ShutdownOptions = {
  timeoutMs?: number;
  registerSignal?: (signal: "SIGTERM" | "SIGINT", handler: () => void) => void;
  exit?: (code: number) => void;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

/** Installs an idempotent graceful drain for the standalone worker process. */
export function installWorkerShutdown(boss: Pick<PgBoss, "stop">, options: ShutdownOptions = {}) {
  // Canonical maintenance has a 240-second coordinator ceiling. One extra
  // minute permits graceful completion without retaining the old 11-minute window.
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const registerSignal = options.registerSignal ?? ((signal, handler) => process.once(signal, handler));
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? ((event) => console.log(`[worker] ${event}`));
  let shuttingDown = false;

  const shutdown = async (signal: "SIGTERM" | "SIGINT" | "STARTUP_FAILURE") => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutdown-started", { signal });
    try {
      await boss.stop({ graceful: true, timeout: timeoutMs });
      log("shutdown-drained", { signal });
    } catch {
      log("shutdown-failed", { signal, errorCode: "pg-boss-stop-failed" });
    } finally {
      exit(signal === "STARTUP_FAILURE" ? 1 : 0);
    }
  };

  registerSignal("SIGTERM", () => void shutdown("SIGTERM"));
  registerSignal("SIGINT", () => void shutdown("SIGINT"));
  return shutdown;
}

/** Registers workers in order and drains already-registered work on failure. */
export async function runWorkerStartup(
  registrations: readonly (() => Promise<void>)[],
  shutdown: (reason: "STARTUP_FAILURE") => Promise<void>,
  onFailure: () => void = () => console.error("[worker] fatal-startup-error"),
): Promise<boolean> {
  try {
    for (const register of registrations) await register();
    return true;
  } catch {
    onFailure();
    await shutdown("STARTUP_FAILURE");
    return false;
  }
}
