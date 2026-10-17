import type { CampaignScope, MeasurementPlan } from "@/src/core/contracts";
import type { CampaignObservationChoice } from "@/src/db/queries/campaign_results";

export function ResultFields({ plan, observations, scope }: { plan: MeasurementPlan | null; observations: CampaignObservationChoice[]; scope: CampaignScope }) {
  const style = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal";
  return <div className="grid gap-3 md:grid-cols-2">
    <p className="text-xs text-muted md:col-span-2">Select imported aggregate observations, not manually entered outcome values. The server validates source permission, population, unit, method, campaign and comparable windows against the accepted plan. This is descriptive reconciliation, not Brand Lift or an expert interpretation.</p>
    <input type="hidden" name="market" value={scope.market} /><input type="hidden" name="language" value={scope.language} />
    {plan?.metrics.map((metric, index) => <fieldset key={metric.key} className="grid gap-2 rounded-md border border-border p-3 md:col-span-2 md:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{metric.label} · {metric.unit} · {metric.population}</legend>
      <input type="hidden" name="plannedMetricKey" value={metric.key} />
      {(["baseline", "result"] as const).map((side) => <label key={side} className="text-xs capitalize">{side} observation<select required defaultValue="" name={`metric-${index}-${side}`} className={style}>
        <option value="">Select source observation</option>
        {observations.filter((item) => item.metricKey === metric.key && item.unit === metric.unit).map((item) => <option key={item.id} value={item.id}>#{item.id} · evidence #{item.evidenceId} · {item.observedAt.slice(0, 10)}</option>)}
      </select></label>)}
    </fieldset>)}
    <a href="/workspace" className="text-xs underline md:col-span-2">Import aggregate observations in Evidence onboarding. Only the latest 1,000 eligible observations are listed here.</a>
  </div>;
}
