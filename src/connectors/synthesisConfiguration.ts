import { validateOpenAISynthesisBinding, type OpenAISynthesisBinding } from "./openaiSynthesis.ts";
import { researchSnapshotDigest } from "../abilities/snapshot.ts";

/** Deployment-owned configuration; never accepted from product/API request JSON. */
export type SynthesisDeploymentBinding = OpenAISynthesisBinding & {
  adapterId: "openai-responses";
  credentialEnv: string;
  sourceConnectionIds: readonly string[];
  qualityApprovalReference: string;
  currency: string;
  maxCostMicros: number;
};
const keys = new Set(["clientId", "model", "abilityIds", "markets", "languages", "allowedSourceClasses", "approvalReference", "expiresAt", "retention", "maxInputBytes", "maxOutputTokens", "maxResponseBytes", "timeoutMs", "adapterId", "credentialEnv", "sourceConnectionIds", "qualityApprovalReference", "currency", "maxCostMicros"]);

export function parseSynthesisConfiguration(raw: string | undefined, clientId: string): SynthesisDeploymentBinding | undefined {
  if (!raw?.trim()) return undefined;
  try {
    if (Buffer.byteLength(raw, "utf8") > 64_000) throw new Error();
    const config = JSON.parse(raw);
    if (!config || config.schemaVersion !== 1 || Object.keys(config).some((key) => !["schemaVersion", "bindings"].includes(key))
      || !Array.isArray(config.bindings) || config.bindings.length > 1) throw new Error();
    const clients = new Set<string>();
    for (const binding of config.bindings as SynthesisDeploymentBinding[]) {
      validateOpenAISynthesisBinding(binding);
      if (Object.keys(binding).some((key) => !keys.has(key)) || binding.adapterId !== "openai-responses"
        || !/^[1-9]\d*$/.test(binding.clientId) || !Number.isSafeInteger(Number(binding.clientId)) || clients.has(binding.clientId)
        || typeof binding.credentialEnv !== "string" || !new RegExp(`^MARKET_RESEARCH_MODEL_KEY_CLIENT_${binding.clientId}_[A-Z0-9_]{1,80}$`).test(binding.credentialEnv)
        || !Array.isArray(binding.sourceConnectionIds) || !binding.sourceConnectionIds.length || binding.sourceConnectionIds.length > 100
        || binding.sourceConnectionIds.some((id) => typeof id !== "string" || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
        || new Set(binding.sourceConnectionIds).size !== binding.sourceConnectionIds.length
        || typeof binding.qualityApprovalReference !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(binding.qualityApprovalReference)
        || typeof binding.currency !== "string" || !/^[A-Z]{3}$/.test(binding.currency)
        || !Number.isSafeInteger(binding.maxCostMicros) || binding.maxCostMicros < 0) throw new Error();
      clients.add(binding.clientId);
    }
    return config.bindings.find((binding: SynthesisDeploymentBinding) => binding.clientId === clientId);
  } catch { throw new Error("synthesis-deployment-configuration-invalid"); }
}

export function synthesisBindingDigest(binding: SynthesisDeploymentBinding) { return researchSnapshotDigest(binding); }
