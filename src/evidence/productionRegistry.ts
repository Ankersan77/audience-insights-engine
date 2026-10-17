import type { AdapterRuntimeContext, CredentialReference } from "../connectors/contracts.ts";
import { AcquisitionAdapterRegistry } from "./registry.ts";

/**
 * Deliberately empty until an adapter passes source-specific permission, minimization and
 * acceptance review. Registering a connector here is the only production activation seam.
 */
export function createProductionAdapterRegistry(): AcquisitionAdapterRegistry {
  return new AcquisitionAdapterRegistry();
}

async function resolveDeploymentCredential(reference: CredentialReference): Promise<string> {
  if (process.env.ENABLE_ENV_CREDENTIAL_RESOLVER !== "true") throw new Error("credential-resolver-not-configured");
  if (reference.provider !== "secret-store" || !reference.key.startsWith("env:")) throw new Error("credential-reference-provider-unsupported");
  const environmentKey = reference.key.slice(4);
  const clientId = process.env.MARKET_RESEARCH_CLIENT_ID;
  if (!clientId || !/^[1-9]\d*$/.test(clientId) || !Number.isSafeInteger(Number(clientId))) throw new Error("deployment-client-id-required");
  if (!new RegExp(`^MARKET_RESEARCH_SOURCE_KEY_CLIENT_${clientId}_[A-Z0-9_]{1,80}$`).test(environmentKey))
    throw new Error("credential-reference-out-of-scope");
  const value = process.env[environmentKey];
  if (!value) throw new Error("credential-unavailable");
  return value;
}

export function createProductionRuntimeContext(): AdapterRuntimeContext {
  return { resolveCredential: resolveDeploymentCredential };
}
