import type { EvidenceItem, QualitativeTheme, QuantitativeObservation } from "../core/contracts.ts";
import type { SourceAcquisitionJob, SourceAcquisitionReceipt } from "../connectors/contracts.ts";
import { assertPeopleBlind, retainEvidence, type EvidenceCandidate, type EvidencePolicy } from "./policy.ts";

export type AdapterRunContext = {
  now: string;
  signal?: AbortSignal;
  resolveCredential(reference: { provider: string; key: string }): Promise<string>;
};

export type AdapterRunResult = {
  evidence: readonly EvidenceItem[];
  quantitativeObservations?: readonly QuantitativeObservation[];
  qualitativeThemes?: readonly QualitativeTheme[];
  receipt: SourceAcquisitionReceipt;
};

/** Raw payloads exist only inside this instance and are never returned or serialized. */
export class EphemeralAcquisitionZone<TRaw> {
  #records = new Map<string, { value: TRaw; expiresAt: number }>();

  put(id: string, value: TRaw, expiresAt: number): void {
    this.#records.set(id, { value, expiresAt });
  }

  take(id: string, now: number): TRaw | undefined {
    const record = this.#records.get(id);
    if (!record || record.expiresAt <= now) {
      this.#records.delete(id);
      return undefined;
    }
    this.#records.delete(id);
    return record.value;
  }

  expire(now: number): number {
    let removed = 0;
    for (const [id, record] of this.#records) {
      if (record.expiresAt <= now) {
        this.#records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#records.size;
  }
}

export abstract class EvidenceAdapter<TRaw> {
  abstract readonly id: string;

  protected abstract acquireRaw(job: SourceAcquisitionJob, context: AdapterRunContext): Promise<readonly TRaw[]>;
  protected abstract normalize(raw: TRaw, job: SourceAcquisitionJob, context: AdapterRunContext): EvidenceCandidate | null;

  async run(job: SourceAcquisitionJob, context: AdapterRunContext, policy: EvidencePolicy): Promise<AdapterRunResult> {
    if (context.signal?.aborted) throw new Error("acquisition-cancelled");
    const rawRecords = await this.acquireRaw(job, context);
    const zone = new EphemeralAcquisitionZone<TRaw>();
    const evidence: EvidenceItem[] = [];
    const quantitativeObservations: QuantitativeObservation[] = [];
    const qualitativeThemes: QualitativeTheme[] = [];
    let rejectedCount = 0;
    const rawExpiry = new Date(context.now).getTime() + 60_000;

    for (let index = 0; index < rawRecords.length; index += 1) {
      if (context.signal?.aborted) throw new Error("acquisition-cancelled");
      const key = `${job.id}:${index}`;
      zone.put(key, rawRecords[index], rawExpiry);
      const raw = zone.take(key, new Date(context.now).getTime());
      const candidate = raw === undefined ? null : this.normalize(raw, job, context);
      if (!candidate) {
        rejectedCount += 1;
        continue;
      }
      const retained = retainEvidence(candidate, policy);
      assertPeopleBlind(retained);
      evidence.push(retained);
      const suppressed = candidate.cohortSize !== undefined && candidate.cohortSize < policy.minimumCohortSize;
      if (candidate.quantitative) {
        quantitativeObservations.push({
          id: `${retained.id}:quantitative`, clientId: retained.clientId, evidenceId: retained.id,
          metricKey: candidate.quantitative.metricKey, value: suppressed ? 0 : candidate.quantitative.value,
          unit: candidate.quantitative.unit, observedAt: candidate.quantitative.observedAt,
          dimensions: candidate.quantitative.dimensions, cohortSize: candidate.quantitative.cohortSize,
          suppressed,
        });
      }
      if (candidate.qualitative) {
        qualitativeThemes.push({
          id: `${retained.id}:qualitative`, clientId: retained.clientId, evidenceIds: [retained.id],
          label: candidate.qualitative.label, paraphrase: candidate.qualitative.paraphrase,
          occurrenceCount: candidate.qualitative.occurrenceCount, sourceDiversity: candidate.qualitative.sourceDiversity,
          method: candidate.qualitative.method, suppressed: suppressed || candidate.qualitative.sourceDiversity < 2,
        });
      }
    }

    zone.expire(Number.POSITIVE_INFINITY);
    const receipt: SourceAcquisitionReceipt = {
      jobId: job.id,
      status: "succeeded",
      acquiredCount: evidence.length,
      rejectedCount,
      safeArtifactRefs: evidence.map((item) => item.id),
      completedAt: context.now,
    };
    assertPeopleBlind(receipt);
    return { evidence, quantitativeObservations, qualitativeThemes, receipt };
  }
}
