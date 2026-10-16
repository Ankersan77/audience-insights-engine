import type { SourceAcquisitionJob } from "../connectors/contracts.ts";
import type { EvidenceAdapter, AdapterRunContext, AdapterRunResult } from "./sdk.ts";
import type { EvidencePolicy } from "./policy.ts";
import type { AcquisitionPlan } from "./acquisitionBudget.ts";

export type RunnableEvidenceAdapter = Pick<EvidenceAdapter<unknown>, "id" | "run"> & {
  /** Pure, synchronous, credential-free declaration; missing bounds block queued execution. */
  plan?(job: SourceAcquisitionJob): AcquisitionPlan;
};

export type AcquisitionAdapterFactoryContext = {
  connectorId: string;
  connectorVersion: string;
  sourceClass: string;
  configuration: Readonly<Record<string, unknown>>;
};

export type AcquisitionAdapterFactory = (context: AcquisitionAdapterFactoryContext) => RunnableEvidenceAdapter;

/** Runtime-only registry. Factories and credentials are code/deployment concerns, never persisted payloads. */
export class AcquisitionAdapterRegistry {
  #factories = new Map<string, AcquisitionAdapterFactory>();

  register(connectorId: string, factory: AcquisitionAdapterFactory): void {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(connectorId)) throw new Error("invalid-connector-id");
    if (this.#factories.has(connectorId)) throw new Error(`duplicate-adapter-registration:${connectorId}`);
    this.#factories.set(connectorId, factory);
  }

  resolve(context: AcquisitionAdapterFactoryContext): RunnableEvidenceAdapter {
    const factory = this.#factories.get(context.connectorId);
    if (!factory) throw new Error(`adapter-unavailable:${context.connectorId}`);
    const adapter = factory(context);
    if (adapter.id !== context.connectorId) throw new Error(`adapter-id-mismatch:${context.connectorId}:${adapter.id}`);
    return adapter;
  }

  list(): readonly string[] { return [...this.#factories.keys()].sort(); }
}

export async function runRegisteredAdapter(input: {
  registry: AcquisitionAdapterRegistry;
  factoryContext: AcquisitionAdapterFactoryContext;
  job: SourceAcquisitionJob;
  runtime: AdapterRunContext;
  policy: EvidencePolicy;
}): Promise<AdapterRunResult> {
  const adapter = input.registry.resolve(input.factoryContext);
  return adapter.run(input.job, input.runtime, input.policy);
}
