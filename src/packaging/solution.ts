import type { SolutionProfile } from "../core/contracts.ts";
import { validateSolutionProfile } from "../core/validation.ts";

export type RedactedSolutionPackage = {
  format: "market-research-solution";
  formatVersion: 1;
  profile: SolutionProfile;
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
  const serialized = JSON.stringify(profile);
  if (SECRET_PATTERN.test(serialized)) throw new Error("solution export contains a credential-like value");
  const redacted = structuredClone(profile);
  const base = { format: "market-research-solution" as const, formatVersion: 1 as const, profile: redacted, exportedAt };
  return { ...base, checksum: checksum(base) };
}

export function importSolutionProfile(value: RedactedSolutionPackage, expectedClientId: string): SolutionProfile {
  if (value.format !== "market-research-solution" || value.formatVersion !== 1) throw new Error("unsupported-solution-package");
  const { checksum: supplied, ...base } = value;
  if (checksum(base) !== supplied) throw new Error("solution-package-checksum-mismatch");
  if (value.profile.clientId !== expectedClientId) throw new Error("solution-package-client-mismatch");
  const validation = validateSolutionProfile(value.profile);
  if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
  return structuredClone(value.profile);
}
