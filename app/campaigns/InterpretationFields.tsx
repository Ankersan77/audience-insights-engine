"use client";

import { useState } from "react";
import type { MeasurementPlan } from "@/src/core/contracts";
import type { CanonicalEvidenceListRow } from "@/src/db/queries/canonical_evidence";
import type { IntelligenceListRow } from "@/src/db/queries/workspace_intelligence";

export function InterpretationFields({ stage, plan, evidence, intelligence }: { stage: "live" | "post"; plan: MeasurementPlan | null; evidence: CanonicalEvidenceListRow[]; intelligence: IntelligenceListRow[] }) {
  const [enabled, setEnabled] = useState(false);
  const style = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal";
  return <div className="mt-4 rounded-md border border-border p-3">
    <label className="flex gap-2 text-sm font-medium"><input name="includeInterpretation" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Add analyst-authored interpretation</label>
    {enabled ? <div className="mt-3 grid gap-3 md:grid-cols-2">
      <p className="text-xs text-muted md:col-span-2">Keep observation, hypothesis, insight and recommendation distinct. Cite the reconciled metrics and reviewed Market Twin context. This is a human proposal, not verified AI expertise. An authorized reviewer must approve any learning.</p>
      {(["observation", "hypothesis", "insight", "recommendation", "clientRelevance", "alternativeExplanations", "wouldChangeConclusion", "conditions"] as const).map((key) => <label key={key} className="text-xs">{key.replace(/([A-Z])/g, " $1")}<textarea required maxLength={4000} name={`interpretation-${key}`} className={style} /></label>)}
      <label className="text-xs">Confidence (analyst judgment)<input required type="number" min="0" max="1" step="0.05" name="interpretation-confidence" defaultValue="0.5" className={style} /></label>
      <label className="text-xs">Reconciled metrics<select required multiple name="interpretation-metricKeys" className={style}>{plan?.metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label>
      <label className="text-xs">Supporting evidence<select required multiple name="interpretation-evidenceIds" className={style}>{evidence.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.externalReference}</option>)}</select></label>
      <label className="text-xs">Accepted Market Twin context<select required multiple name="interpretation-intelligenceIds" className={style}>{intelligence.filter((item) => item.lifecycle === "live" && item.reviewState === "accepted").map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.title}</option>)}</select></label>
      {stage === "post" ? <label className="text-xs md:col-span-2">Conditional learning proposal (optional; not a causal claim)<textarea maxLength={4000} name="interpretation-learningStatement" className={style} /></label> : null}
    </div> : null}
  </div>;
}
