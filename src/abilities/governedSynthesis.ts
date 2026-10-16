import { randomUUID } from "node:crypto";
import { researchSnapshotDigest } from "./snapshot.ts";
import type { ResearchSynthesisInput, ResearchSynthesisProvider } from "./synthesis.ts";
import { validateSynthesisAttempt, type SynthesisSpendLedger, type SynthesisSpendPlan, type SynthesisPermit, type SynthesisOutcome } from "./synthesisBudget.ts";

/** Application-level admission wrapper. Factory/planner are trusted server code.
 * Plan must be synchronous and credential-free. Factory must meter its single
 * bounded provider request against the same plan; this is not a network sandbox.
 */
export function withSynthesisBudget(options: {
  id: string;
  version: string;
  ledger: SynthesisSpendLedger;
  plan(input: ResearchSynthesisInput): SynthesisSpendPlan;
  createProvider(input: { plan: SynthesisSpendPlan; signal: AbortSignal }): Promise<ResearchSynthesisProvider>;
  signal?: AbortSignal;
}): ResearchSynthesisProvider {
  return {
    id: options.id, version: options.version,
    async synthesize(input) {
      let permit: SynthesisPermit | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome: SynthesisOutcome = "failed";
      let finalized = false;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (options.signal?.aborted) controller.abort();
        if (controller.signal.aborted) { outcome = "cancelled"; throw new Error("synthesis-cancelled"); }
        // The caller cannot alter tenant, input or plan while admission waits on a lock.
        const request = structuredClone(input);
        if (request.context?.clientId !== request.clientId) throw new Error("synthesis-context-required");
        const plan = structuredClone(options.plan(structuredClone(request)));
        const attempt = { clientId: request.clientId, attemptKey: randomUUID(), abilityId: request.abilityId,
          inputDigest: researchSnapshotDigest(request), plan };
        validateSynthesisAttempt(attempt);
        if (plan.providerId !== options.id || plan.providerVersion !== options.version) throw new Error("synthesis-provider-plan-mismatch");
        if (Buffer.byteLength(JSON.stringify(request), "utf8") > plan.maxInputBytes) throw new Error("synthesis-input-too-large");
        permit = await options.ledger.reserve(attempt);
        if (controller.signal.aborted) { outcome = "cancelled"; throw new Error("synthesis-cancelled"); }
        const dispatched = await options.ledger.dispatch(permit);
        // From this point on, failure/cancellation may have incurred external cost.
        outcome = "unknown";
        if (controller.signal.aborted) throw new Error("synthesis-cancelled");
        const remainingMs = Math.min(plan.maxDurationMs, Date.parse(dispatched.expiresAt) - Date.now());
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) throw new Error("synthesis-permit-expired");
        let rejectAborted: (() => void) | undefined;
        const deadline = new Promise<never>((_, reject) => {
          rejectAborted = () => reject(new Error("synthesis-cancelled"));
          controller.signal.addEventListener("abort", rejectAborted, { once: true });
          timer = setTimeout(() => controller.abort(), remainingMs);
        });
        try {
          const execute = async () => {
            const provider = await options.createProvider({ plan: structuredClone(plan), signal: controller.signal });
            if (controller.signal.aborted) throw new Error("synthesis-cancelled");
            if (provider.id !== options.id || provider.version !== options.version) throw new Error("synthesis-provider-plan-mismatch");
            return provider.synthesize(request);
          };
          const result = await Promise.race([execute(), deadline]);
          if (controller.signal.aborted) throw new Error("synthesis-cancelled");
          const receipt = await options.ledger.finish(permit, "succeeded");
          finalized = true;
          if (!receipt.accepted || controller.signal.aborted) throw new Error("synthesis-result-not-authorized");
          return result;
        } finally { if (rejectAborted) controller.signal.removeEventListener("abort", rejectAborted); }
      } catch {
        controller.abort();
        if (permit && !finalized) {
          // A failed receipt write leaves a charged, unresolved attempt. Never retry
          // a provider call or expose its result merely because persistence failed.
          try { await options.ledger.finish(permit, outcome); } catch { /* conservative reservation remains */ }
        }
        throw new Error("governed-synthesis-unavailable");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
      }
    },
  };
}
