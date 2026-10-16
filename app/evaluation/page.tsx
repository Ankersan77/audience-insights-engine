import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { listQualityEvaluations, listValidationGates } from "@/src/db/queries/evaluation";
import { requireSession } from "@/src/lib/auth";
import { canReview } from "@/src/lib/roles";
import { EvaluationWorkspace } from "./EvaluationWorkspace";

export const dynamic = "force-dynamic";

export default async function EvaluationPage() {
  const session = await requireSession("/evaluation");
  const [scorecards, gates] = await Promise.all([listQualityEvaluations(session.clientId), listValidationGates(session.clientId)]);
  return <AppShell user={session}>
    <PageHeader title="Quality & pilot evidence" description="Human benchmark scorecards, remediation evidence and external release gates. Nothing is marked verified without an owner and durable reference." />
    <EvaluationWorkspace initialScorecards={scorecards} initialGates={gates} canEvaluate={canReview(session)} />
  </AppShell>;
}
