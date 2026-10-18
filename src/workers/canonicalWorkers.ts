import type { PgBoss } from "pg-boss";
import type { AdapterRuntimeContext } from "@/src/connectors/contracts";
import type { AcquisitionAdapterRegistry } from "@/src/evidence/registry";
import { startAcquisitionWorker } from "./acquisitionQueue.ts";
import { startCanonicalMaintenance } from "./canonicalMaintenance.ts";
import { startSynthesisMaintenance } from "./synthesisMaintenance.ts";

type CanonicalWorkerDependencies = {
  registry?: AcquisitionAdapterRegistry;
  runtime?: AdapterRuntimeContext;
  startAcquisition?: typeof startAcquisitionWorker;
  startMaintenance?: typeof startCanonicalMaintenance;
  startSynthesis?: typeof startSynthesisMaintenance;
};

/** Registers the complete production worker set: canonical acquisition and maintenance only. */
export async function startCanonicalWorkers(boss: PgBoss, dependencies: CanonicalWorkerDependencies = {}): Promise<void> {
  const startAcquisition = dependencies.startAcquisition ?? startAcquisitionWorker;
  const startMaintenance = dependencies.startMaintenance ?? startCanonicalMaintenance;
  const startSynthesis = dependencies.startSynthesis ?? startSynthesisMaintenance;
  await startAcquisition(boss, { registry: dependencies.registry, runtime: dependencies.runtime });
  await startMaintenance(boss);
  await startSynthesis(boss);
}
