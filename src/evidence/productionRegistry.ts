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
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(environmentKey)) throw new Error("credential-reference-invalid");
  const value = process.env[environmentKey];
  if (!value) throw new Error("credential-unavailable");
  return value;
}

export function createProductionRuntimeContext(): AdapterRuntimeContext {
  return { resolveCredential: resolveDeploymentCredential };
}
