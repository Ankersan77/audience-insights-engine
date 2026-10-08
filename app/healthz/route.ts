// Health endpoint for the Docker HEALTHCHECK, the Kubernetes liveness and
// readiness probes, and the ALB target-group health check. Keep it dynamic so it
// reflects the running process rather than a value baked in at build time.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { status: 200 });
}
