import type { SolutionProfile } from "../core/contracts.ts";
import { validateSolutionProfile } from "../core/validation.ts";

export type PortableSolutionProfile = Pick<SolutionProfile,
  "enabledAbilities" | "providerBindings" | "markets" | "languages" | "reviewRoles" | "retention"
>;

export type RedactedSolutionPackage = {
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

export function exportSolutionProfile(profile: SolutionProfile, exportedAt: string): RedactedSolutionPackage {
  const validation = validateSolutionProfile(profile);
  if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
  const portable: PortableSolutionProfile = {
    enabledAbilities: structuredClone(profile.enabledAbilities),
    providerBindings: structuredClone(profile.providerBindings),
    markets: structuredClone(profile.markets),
    languages: structuredClone(profile.languages),
    reviewRoles: structuredClone(profile.reviewRoles),
    retention: structuredClone(profile.retention),
  };
  const serialized = JSON.stringify(portable);
  if (SECRET_PATTERN.test(serialized)) throw new Error("solution export contains a credential-like value");
  const base = { format: "market-research-solution" as const, formatVersion: 2 as const, profile: portable, exportedAt };
  return { ...base, checksum: checksum(base) };
}

export function importSolutionProfile(value: unknown): PortableSolutionProfile {
  if (!value || typeof value !== "object") throw new Error("unsupported-solution-package");
  const packageValue = value as RedactedSolutionPackage;
  if (packageValue.format !== "market-research-solution" || packageValue.formatVersion !== 2 || !packageValue.profile) throw new Error("unsupported-solution-package");
  const { checksum: supplied, ...base } = packageValue;
  if (checksum(base) !== supplied) throw new Error("solution-package-checksum-mismatch");
  const candidate: SolutionProfile = {
    ...packageValue.profile,
    id: "portable-validation",
    clientId: "portable-validation",
    version: 1,
    status: "draft",
    createdAt: packageValue.exportedAt,
  };
  const validation = validateSolutionProfile(candidate);
  if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
  return structuredClone(packageValue.profile);
}
