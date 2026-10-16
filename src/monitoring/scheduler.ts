import type { SourceAcquisitionJob } from "../connectors/contracts.ts";
import type { SensingProfile } from "../core/contracts.ts";
import { validateSensingProfile } from "../core/validation.ts";

export type SupportedCadence = "hourly" | "daily" | "weekly" | "monthly";

function isoWeek(date: Date): string {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monitoringScheduleKey(profile: SensingProfile, now: string): string {
  const validation = validateSensingProfile(profile);
  if (!validation.valid) throw new Error(`invalid-sensing-profile:${validation.errors.join(";")}`);
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("invalid-monitoring-time");
  const cadence = profile.cadence as SupportedCadence;
  if (cadence === "hourly") return `${profile.id}:hour:${date.toISOString().slice(0, 13)}`;
  if (cadence === "daily") return `${profile.id}:day:${date.toISOString().slice(0, 10)}`;
  if (cadence === "weekly") return `${profile.id}:week:${isoWeek(date)}`;
  if (cadence === "monthly") return `${profile.id}:month:${date.toISOString().slice(0, 7)}`;
  throw new Error(`unsupported-monitoring-cadence:${profile.cadence}`);
}

export function planMonitoringAcquisitions(input: {
  profile: SensingProfile;
  now: string;
  monitoringRunId: string;
}): SourceAcquisitionJob[] {
  const scheduleKey = monitoringScheduleKey(input.profile, input.now);
  return input.profile.sourceConnectionIds.map((sourceId) => ({
    id: `${input.monitoringRunId}:${sourceId}`,
    clientId: input.profile.clientId,
    sourceId,
    adapterId: "configured-source-adapter",
    dataClassification: "licensed",
    request: {
      operation: "monitor",
      filters: {
        themes: input.profile.themes,
        markets: input.profile.markets,
        competitors: input.profile.competitors,
        products: input.profile.products,
      },
    },
    idempotencyKey: `${scheduleKey}:${sourceId}`,
    requestedAt: input.now,
  }));
}

