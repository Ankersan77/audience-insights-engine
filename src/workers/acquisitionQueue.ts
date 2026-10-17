import { PgBoss, type Job } from "pg-boss";
import type { AdapterRuntimeContext } from "@/src/connectors/contracts";
import { claimAcquisitionJob, cancelAcquisitionJob, isAcquisitionCancelled, listQueuedAcquisitionJobIds, listStaleRunningAcquisitions, type ClaimedAcquisition } from "@/src/db/queries/acquisition_execution";
import { completeExistingAcquisition, failExistingAcquisition } from "@/src/db/queries/canonical_evidence";
import { AcquisitionAdapterRegistry } from "@/src/evidence/registry";
import { authorizeAcquisitionAttempt } from "@/src/db/queries/acquisition_budget";
import { createAcquisitionRequestGate, validatePlanAgainstSource, type AcquisitionRequestGate } from "@/src/evidence/acquisitionBudget";
import { acquisitionLimitFailure } from "@/src/connectors/sourcePolicy";
import { classifyAcquisitionError } from "@/src/evidence/executionPolicy";
import { logEvent } from "@/src/lib/metrics";
import { retryDelay, shouldRetry, type RetryPolicy } from "@/src/operations/resilience";

export const ACQUISITION_QUEUE_NAME = "market-research-source-acquisition";
export type AcquisitionQueuePayload = { databaseJobId: number };

const RETRY_POLICY: RetryPolicy = { maximumAttempts: 3, baseDelayMs: 1_000, maximumDelayMs: 5_000, retryableCodes: ["rate-limit", "timeout", "transient"] };

function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function collectionMetadata(claimed: ClaimedAcquisition, now: Date) {
  const filters = claimed.job.request.filters ?? {};
  const values = (key: string): string[] => {
    const value = filters[key];
    return typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  return {
    title: `${claimed.connectorId} acquisition ${claimed.databaseJobId}`,
    method: { method: `${claimed.connectorId}@${claimed.connectorVersion} adapter`, limitations: [] },
    applicability: { markets: values("markets"), languages: values("languages"), categories: values("categories"), audiences: values("audiences"), campaigns: values("campaigns") },
    collectionExpiresAt: new Date(now.getTime() + claimed.retentionDays * 86_400_000).toISOString(),
  };
}

export async function processAcquisitionJob(input: {
  databaseJobId: number;
  registry: AcquisitionAdapterRegistry;
  runtime: AdapterRuntimeContext;
  now?: Date;
}): Promise<"completed" | "failed" | "cancelled" | "already-claimed"> {
  const now = input.now ?? new Date();
  const claim = await claimAcquisitionJob(input.databaseJobId, now);
  if (claim.kind === "unavailable") return "already-claimed";
  if (claim.kind === "blocked") {
    logEvent("canonical-acquisition-policy-blocked", { jobId: input.databaseJobId, errorCode: claim.errorCode });
    return "failed";
  }
  const claimed = claim.value;
  const abortController = new AbortController();
  const cancellationPoll = setInterval(() => {
    void isAcquisitionCancelled(claimed.databaseJobId).then((cancelled) => { if (cancelled) abortController.abort(); }).catch(() => undefined);
  }, 1_000);
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= RETRY_POLICY.maximumAttempts; attempt += 1) {
      let providerReturned = false;
      let acquisition: AcquisitionRequestGate | undefined;
      try {
      const adapter = input.registry.resolve({ connectorId: claimed.connectorId, connectorVersion: claimed.connectorVersion, sourceClass: claimed.sourceClass, configuration: claimed.configuration });
      if (!adapter.plan) throw new Error("budget-plan-required");
      const proposed = adapter.plan(claimed.job);
      const plan = Object.freeze({ currency: proposed?.currency, maxCostMicros: proposed?.maxCostMicros, maxRecords: proposed?.maxRecords, maxRequests: proposed?.maxRequests });
      validatePlanAgainstSource(plan, claimed.policy);
      if (await isAcquisitionCancelled(claimed.databaseJobId)) abortController.abort();
      if (abortController.signal.aborted) throw new Error("acquisition-cancelled");
      const authorization = await authorizeAcquisitionAttempt({ clientId: Number(claimed.job.clientId), jobId: claimed.databaseJobId, attempt, plan });
      acquisition = createAcquisitionRequestGate(plan, authorization.attemptKey, abortController.signal);
      const gate = acquisition;
      const result = await adapter.run(claimed.job,
        { now: new Date().toISOString(), signal: abortController.signal, acquisition: gate, resolveCredential: (reference) => {
          gate.assertCredentialAccess();
          if (!claimed.job.credentialRef || reference.provider !== claimed.job.credentialRef.provider
            || reference.key !== claimed.job.credentialRef.key) throw new Error("credential-reference-out-of-scope");
          return input.runtime.resolveCredential(reference);
        } },
        { minimumCohortSize: Number(process.env.MINIMUM_COHORT_SIZE ?? 10), retainedEvidenceDays: claimed.retentionDays, allowVerbatim: false, sensitiveTerms: [] },
      );
      providerReturned = true;
      gate.assertResult(result.receipt.acquiredCount + result.receipt.rejectedCount);
      gate.close();
      if (result.evidence.some((item) => item.sourceClass !== claimed.sourceClass)) throw new Error("source-class-mismatch");
      const limitFailure = acquisitionLimitFailure(claimed.policy, result.receipt);
      if (limitFailure) throw new Error(limitFailure);
      const metadata = collectionMetadata(claimed, now);
      await completeExistingAcquisition({ clientId: Number(claimed.job.clientId), sourceConnectionId: claimed.sourceConnectionId, jobId: claimed.databaseJobId, rights: claimed.rights, result, ...metadata });
      logEvent("canonical-acquisition-succeeded", { jobId: claimed.databaseJobId, clientId: claimed.job.clientId, connectorId: claimed.connectorId, acquiredCount: result.receipt.acquiredCount, rejectedCount: result.receipt.rejectedCount, attempt });
      return "completed";
      } catch (error) {
        acquisition?.close();
        lastError = error;
        const code = classifyAcquisitionError(error);
        if (code === "cancelled" || abortController.signal.aborted) {
          await cancelAcquisitionJob({ clientId: Number(claimed.job.clientId), id: claimed.databaseJobId, now: new Date() });
          logEvent("canonical-acquisition-cancelled", { jobId: claimed.databaseJobId, connectorId: claimed.connectorId });
          return "cancelled";
        }
        // A persistence/validation failure must never trigger another external acquisition.
        // An uncertain provider failure retains its entire authorization; a retry needs a new one.
        if (providerReturned || !shouldRetry(RETRY_POLICY, attempt, code)) break;
        logEvent("canonical-acquisition-retrying", { jobId: claimed.databaseJobId, connectorId: claimed.connectorId, attempt, errorCode: code });
        await wait(retryDelay(RETRY_POLICY, attempt));
      } finally {
        acquisition?.close();
      }
    }
  } finally {
    clearInterval(cancellationPoll);
  }
  const errorCode = classifyAcquisitionError(lastError);
  await failExistingAcquisition({ clientId: Number(claimed.job.clientId), jobId: claimed.databaseJobId, sourceConnectionId: claimed.sourceConnectionId, errorCode, now: new Date() });
  logEvent("canonical-acquisition-failed", { jobId: claimed.databaseJobId, clientId: claimed.job.clientId, connectorId: claimed.connectorId, errorCode });
  return "failed";
}

export async function dispatchQueuedAcquisitions(boss: Pick<PgBoss, "send">, limit = 100): Promise<number> {
  const ids = await listQueuedAcquisitionJobIds(limit);
  let dispatched = 0;
  for (const databaseJobId of ids) {
    const queued = await boss.send(ACQUISITION_QUEUE_NAME, { databaseJobId }, { singletonKey: `db-job-${databaseJobId}`, singletonSeconds: 86_400 });
    if (queued) dispatched += 1;
  }
  return dispatched;
}

export async function reconcileStaleAcquisitions(now = new Date()): Promise<number> {
  const stale = await listStaleRunningAcquisitions(new Date(now.getTime() - 20 * 60_000));
  let failed = 0;
  for (const job of stale) {
    if (await failExistingAcquisition({ ...job, jobId: job.id, errorCode: "worker-lease-expired", now })) failed += 1;
  }
  if (failed > 0) logEvent("canonical-acquisition-stale-reconciled", { failed });
  return failed;
}

export async function startAcquisitionWorker(boss: PgBoss, dependencies?: { registry?: AcquisitionAdapterRegistry; runtime?: AdapterRuntimeContext }): Promise<void> {
  const registry = dependencies?.registry ?? new AcquisitionAdapterRegistry();
  const runtime = dependencies?.runtime ?? { async resolveCredential() { throw new Error("credential-resolver-not-configured"); } };
  await boss.createQueue(ACQUISITION_QUEUE_NAME, { retryLimit: 0, expireInSeconds: 15 * 60 });
  await boss.work<AcquisitionQueuePayload>(ACQUISITION_QUEUE_NAME, async (jobs: Job<AcquisitionQueuePayload>[]) => {
    for (const job of jobs) {
      try { await processAcquisitionJob({ databaseJobId: job.data.databaseJobId, registry, runtime }); }
      catch (error) { logEvent("canonical-acquisition-worker-error", { jobId: job.data.databaseJobId, errorCode: classifyAcquisitionError(error) }); }
    }
  });
}
