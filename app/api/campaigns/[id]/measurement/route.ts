import { NextRequest, NextResponse } from "next/server";
import { createMeasurementPlanRecord } from "@/src/db/queries/campaign_workspace";
import { redactIdentifiers } from "@/src/evidence/policy";
import { recordGovernanceAudit } from "@/src/lib/audit";
import { getSession } from "@/src/lib/auth";
import { assertResearchWrite, PermissionDeniedError } from "@/src/lib/roles";

function text(value: unknown): string { return typeof value === "string" ? redactIdentifiers(value.trim()).content : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(text).filter(Boolean) : []; }

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  try { assertResearchWrite(session); } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "permission-denied" }, { status: 403 });
    throw error;
  }
  const campaignId = Number((await context.params).id);
  const body = (await request.json()) as Record<string, unknown>;
  const baseline = Number(body.baseline), target = Number(body.target), materiality = Number(body.materiality);
  const direction = ["increase", "decrease", "target"].includes(String(body.direction)) ? body.direction as "increase" | "decrease" | "target" : "increase";
  const aggregation = ["count", "sum", "mean", "rate", "index"].includes(String(body.aggregation)) ? body.aggregation as "count" | "sum" | "mean" | "rate" | "index" : "rate";
  const metricKey = text(body.metricKey), unit = text(body.unit), population = text(body.population);
  if (!Number.isInteger(campaignId) || !text(body.objective) || !text(body.hypothesis) || !metricKey || !unit || !population || ![baseline, target, materiality].every(Number.isFinite)) {
    return NextResponse.json({ error: "Complete objective, hypothesis, population, metric, baseline, target, and materiality." }, { status: 400 });
  }
  try {
    const created = await createMeasurementPlanRecord({ clientId: session.clientId, campaignId, plan: {
      objective: text(body.objective), hypothesis: text(body.hypothesis), population,
      metrics: [{ key: metricKey, label: text(body.metricLabel) || metricKey, unit, direction, aggregation, population }],
      baseline: { [metricKey]: baseline }, targets: { [metricKey]: target }, checkpoints: strings(body.checkpoints),
      exposureDefinition: text(body.exposureDefinition) || undefined, attributionAssumptions: strings(body.attributionAssumptions),
      incrementalityDesign: text(body.incrementalityDesign) || undefined, materialityThresholds: { [metricKey]: materiality }, decisionRules: strings(body.decisionRules),
    } });
    await recordGovernanceAudit({ clientId: session.clientId, actorUserId: session.id, action: "create", entityType: "measurement_plan", entityId: String(created.id), after: { campaignId, version: created.version } });
    return NextResponse.json({ measurementPlan: created }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Measurement plan could not be created." }, { status: 400 }); }
}

