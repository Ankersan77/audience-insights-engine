import type { SensingProfile, SolutionProfile } from "../core/contracts.ts";
import { validateSensingProfile, validateSolutionProfile } from "../core/validation.ts";

export type PortableSolutionProfile = Pick<SolutionProfile,
  "enabledAbilities" | "providerBindings" | "markets" | "languages" | "reviewRoles" | "retention" | "briefingCadences"
>;

export type PortableSensingProfile = Omit<SensingProfile, "id" | "clientId" | "version">;

export type RedactedSolutionPackage = {
  format: "market-research-solution";
  formatVersion: 3;
  profile: PortableSolutionProfile;
  sensingProfile?: PortableSensingProfile;
  exportedAt: string;
  checksum: string;
};

type LegacySolutionPackageV2 = {
  format: "market-research-solution";
  formatVersion: 2;
  profile: PortableSolutionProfile;
  exportedAt: string;
  checksum: string;
};

const SECRET_PATTERN = /(secret|token|password|api[-_]?key|bearer|private[-_]?key)/i;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  let hash = 2166136261;
  for (const char of stableJson(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function exportSolutionProfile(profile: SolutionProfile, exportedAt: string, sensingProfile?: SensingProfile): RedactedSolutionPackage {
  const validation = validateSolutionProfile(profile);
  if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
  const portable: PortableSolutionProfile = {
    enabledAbilities: structuredClone(profile.enabledAbilities),
    providerBindings: structuredClone(profile.providerBindings),
    markets: structuredClone(profile.markets),
    languages: structuredClone(profile.languages),
    reviewRoles: structuredClone(profile.reviewRoles),
    retention: structuredClone(profile.retention),
    ...(profile.briefingCadences ? { briefingCadences: [...profile.briefingCadences] } : {}),
  };
  if (profile.sensingProfileId && (!sensingProfile || sensingProfile.id !== profile.sensingProfileId || sensingProfile.clientId !== profile.clientId)) {
    throw new Error("solution sensing profile is required and must match the client binding");
  }
  const portableSensing = sensingProfile ? {
    themes: [...sensingProfile.themes], markets: [...sensingProfile.markets], competitors: [...sensingProfile.competitors], products: [...sensingProfile.products],
    audiences: [...sensingProfile.audiences], occasions: [...sensingProfile.occasions], risks: [...sensingProfile.risks], sourceConnectionIds: [...sensingProfile.sourceConnectionIds],
    cadence: sensingProfile.cadence, lookbackDays: sensingProfile.lookbackDays, materialityThreshold: sensingProfile.materialityThreshold,
    noveltyThreshold: sensingProfile.noveltyThreshold, confidenceThreshold: sensingProfile.confidenceThreshold, freshnessDays: sensingProfile.freshnessDays,
    expiryDays: sensingProfile.expiryDays, minimumCorroboration: sensingProfile.minimumCorroboration, deduplicationWindowDays: sensingProfile.deduplicationWindowDays,
    seasonalExpectations: structuredClone(sensingProfile.seasonalExpectations), suppressionRules: [...sensingProfile.suppressionRules], downRankingRules: [...sensingProfile.downRankingRules],
    destinations: [...sensingProfile.destinations], humanReviewRequired: sensingProfile.humanReviewRequired, decisionContexts: [...sensingProfile.decisionContexts], quietPeriods: structuredClone(sensingProfile.quietPeriods),
  } satisfies PortableSensingProfile : undefined;
  const serialized = JSON.stringify({ portable, portableSensing });
  if (SECRET_PATTERN.test(serialized)) throw new Error("solution export contains a credential-like value");
  const base = { format: "market-research-solution" as const, formatVersion: 3 as const, profile: portable, sensingProfile: portableSensing, exportedAt };
  return { ...base, checksum: checksum(base) };
}

export function importSolutionPackage(value: unknown): { profile: PortableSolutionProfile; sensingProfile?: PortableSensingProfile } {
  if (!value || typeof value !== "object") throw new Error("unsupported-solution-package");
  const packageValue = value as RedactedSolutionPackage | LegacySolutionPackageV2;
  if (packageValue.format !== "market-research-solution" || ![2, 3].includes(packageValue.formatVersion) || !packageValue.profile) {
    throw new Error("unsupported-solution-package");
  }
  const { checksum: supplied, ...base } = packageValue;
  if (checksum(base) !== supplied) throw new Error("solution-package-checksum-mismatch");
  const candidate: SolutionProfile = {
    ...packageValue.profile,
    id: "portable-validation",
    clientId: "portable-validation",
    version: 1,
    status: "draft",
    createdAt: packageValue.exportedAt,
    sensingProfileId: packageValue.formatVersion === 3 && packageValue.sensingProfile ? "portable-validation" : undefined,
  };
  const validation = validateSolutionProfile(candidate);
  if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
  const sensing = packageValue.formatVersion === 3 ? packageValue.sensingProfile : undefined;
  if (sensing) {
    const sensingValidation = validateSensingProfile({ ...sensing, id: "portable-validation", clientId: "portable-validation", version: 1 });
    if (!sensingValidation.valid) throw new Error(`invalid-sensing-profile:${sensingValidation.errors.join(";")}`);
  }
  return { profile: structuredClone(packageValue.profile), sensingProfile: structuredClone(sensing) };
}

export function importSolutionProfile(value: unknown): PortableSolutionProfile {
  return importSolutionPackage(value).profile;
}
