import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access } from "node:fs/promises";

/** Isolated real HTTP server using synthetic identity and a dedicated test database. */
export async function startTestHttpServer(databaseUrl: string) {
  if (!new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("HTTP tests require a dedicated test database");
  await access(".next/BUILD_ID");
  const allocator = createServer();
  await new Promise<void>((resolve) => allocator.listen(0, "127.0.0.1", resolve));
  const address = allocator.address();
  if (!address || typeof address === "string") throw new Error("test-port-unavailable");
  const port = address.port;
  await new Promise<void>((resolve, reject) => allocator.close((error) => error ? reject(error) : resolve()));
  const secret = "synthetic-http-integration-signing-key-not-for-production";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl, SESSION_SECRET: secret, APP_ORIGIN: `http://127.0.0.1:${port}` }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4000); });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timeout);
  }
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 30_000;
    while (true) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) throw new Error(`HTTP test server did not start: ${output}`);
      try { if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) { await stop(); throw error; }
  return {
    stop,
    async request(path: string, token?: string, body?: unknown, origin: string | null = base) {
      const headers = new Headers();
      if (token) headers.set("cookie", `market_research_session=${token}`);
      if (body !== undefined) headers.set("content-type", "application/json");
      if (body !== undefined && origin !== null) headers.set("origin", origin);
      return fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20_000) });
    },
  };
}
