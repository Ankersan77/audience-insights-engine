"use client";

import { PREFLIGHT_DIMENSIONS } from "@/src/campaigns/preflightFields";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { IntelligenceListRow } from "@/src/db/queries/workspace_intelligence";
import type { CampaignScope } from "@/src/core/contracts";
import { campaignScopeKey } from "@/src/campaigns/scope";

export function PreflightFields({ evidence, intelligence, targetScopes }: { evidence: CanonicalEvidenceListRow[]; intelligence: IntelligenceListRow[]; targetScopes: readonly CampaignScope[] }) {
  const reviewed = intelligence.filter((item) => item.lifecycle === "live" && item.reviewState === "accepted");
  const inputClass = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal";
  return <div className="mt-3 grid gap-3 md:grid-cols-2">
    <p className="text-xs text-muted md:col-span-2">Analyst-authored review, not an automated expert verdict. Every finding must reference current evidence and accepted Market Twin knowledge. The server checks applicability and rights; a reviewer still judges whether the reasoning is sound.</p>
    <label className="text-xs font-medium md:col-span-2">Review scope<select required name="preflightScope" className={inputClass} defaultValue={targetScopes.length === 1 ? campaignScopeKey(targetScopes[0]) : ""}><option value="">Select a declared market/language pair</option>{targetScopes.map((scope) => <option key={campaignScopeKey(scope)} value={campaignScopeKey(scope)}>{campaignScopeKey(scope)}</option>)}</select></label>
    {(["pointOfView", "recommendation", "alternative", "wouldChangeConclusion"] as const).map((field) => <label key={field} className="text-xs font-medium md:col-span-2">{field.replace(/([A-Z])/g, " $1")}<textarea required maxLength={4000} name={`preflight-${field}`} className={inputClass} /></label>)}
    {PREFLIGHT_DIMENSIONS.map((dimension) => <fieldset key={dimension} className="grid gap-2 rounded-md border border-border p-3 md:col-span-2 md:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{dimension.replaceAll("_", " ")}</legend>
      <label className="text-xs">Judgment<select name={`${dimension}-verdict`} defaultValue="unresolved" className={inputClass}><option value="unresolved">Unresolved</option><option value="aligned">Aligned with cited evidence and strategy</option><option value="tension">Material tension — revise before approval</option></select></label>
      <label className="text-xs">Reasoning<textarea required maxLength={4000} name={`${dimension}-rationale`} className={inputClass} /></label>
      <label className="text-xs">Evidence (multiple selections allowed)<select multiple name={`${dimension}-evidence`} className={inputClass}>{evidence.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.externalReference}</option>)}</select></label>
      <label className="text-xs">Reviewed Market Twin records<select multiple name={`${dimension}-intelligence`} className={inputClass}>{reviewed.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.title}</option>)}</select></label>
    </fieldset>)}
    <label className="text-xs font-medium md:col-span-2">Decision rationale for known contradictions (required when the context contains contradictions)<textarea maxLength={4000} name="preflight-contradictionResponse" className={inputClass} /></label>
  </div>;
}
