"use client";

import { useState } from "react";
import type { CampaignScope, MeasurementPlan } from "@/src/core/contracts";
import type { CampaignObservationChoice } from "@/src/db/queries/campaign_results";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { IntelligenceListRow } from "@/src/db/queries/workspace_intelligence";
import { campaignScopeKey } from "@/src/campaigns/scope";
import { measurementForScope } from "@/src/campaigns/measurementScope";
import { ResultFields } from "./ResultFields";
import { InterpretationFields } from "./InterpretationFields";

export function ScopedResultFields({ plan, scopes, stage, observations, evidence, intelligence }: { plan: MeasurementPlan | null; scopes: readonly CampaignScope[]; stage: "live" | "post"; observations: CampaignObservationChoice[]; evidence: CanonicalEvidenceListRow[]; intelligence: IntelligenceListRow[] }) {
  const [selected, setSelected] = useState(scopes.length === 1 ? campaignScopeKey(scopes[0]) : "");
  const scope = scopes.find((item) => campaignScopeKey(item) === selected);
  let scopedPlan: MeasurementPlan | undefined;
  if (plan && scope) { try { scopedPlan = measurementForScope(plan, scope); } catch { /* Missing coverage is visible below; the API also fails closed. */ } }
  return <div className="grid gap-3">
    <label className="text-xs font-medium">Result scope<select required name="resultScope" value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Select a declared market/language pair</option>{scopes.map((item) => <option key={campaignScopeKey(item)} value={campaignScopeKey(item)}>{campaignScopeKey(item)}</option>)}</select></label>
    {scopedPlan && scope ? <div key={selected}><p className="mb-3 text-xs text-muted">Population: {scopedPlan.population}. Only this scope is assessed; observations are never pooled across markets.</p><ResultFields plan={scopedPlan} observations={observations} scope={scope} /><InterpretationFields stage={stage} plan={scopedPlan} evidence={evidence} intelligence={intelligence} /></div> : <p className="text-sm text-muted">Select a pair with a frozen measurement configuration. Undeclared legacy or shared multi-market plans cannot authorize scoped readback.</p>}
  </div>;
}
