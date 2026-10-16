/**
 * Provider-neutral connector seams for Market Research.
 *
 * Persisted jobs and receipts contain only tenant scope, opaque credential
 * references, safe selectors and operational metadata. Credentials and raw
 * provider payloads are supplied at runtime and must never be serialized into
 * either structure.
 */

export type DataClassification = "public" | "licensed" | "client-confidential";
export type AcquisitionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type CredentialReference = {
  provider: string;
  key: string;
};

export type SourceAcquisitionRequest = {
  operation: string;
  cursor?: string;
  since?: string;
  until?: string;
  filters?: Readonly<Record<string, string | readonly string[]>>;
};

export type SourceAcquisitionJob = {
  id: string;
  clientId: string;
  sourceId: string;
  adapterId: string;
  credentialRef?: CredentialReference;
  dataClassification: DataClassification;
  request: SourceAcquisitionRequest;
  idempotencyKey: string;
  requestedAt: string;
};

export type SourceAcquisitionReceipt = {
  jobId: string;
  status: AcquisitionStatus;
  acquiredCount: number;
  rejectedCount: number;
  estimatedCost?: number;
  nextCursor?: string;
  safeArtifactRefs: readonly string[];
  errorCode?: string;
  completedAt?: string;
};

export type NormalizedEvidenceRecord = {
  externalId: string;
  sourceId: string;
  observedAt: string;
  retrievedAt: string;
  text?: string;
  sourceUrl?: string;
  geography?: string;
  language?: string;
  classification: DataClassification;
  provenance: Readonly<Record<string, string>>;
};

export type AdapterRuntimeContext = {
  resolveCredential(reference: CredentialReference): Promise<string>;
};

export interface EvidenceSourceAdapter {
  readonly id: string;
  checkConnection(job: SourceAcquisitionJob, context: AdapterRuntimeContext): Promise<void>;
  acquire(
    job: SourceAcquisitionJob,
    context: AdapterRuntimeContext,
  ): AsyncIterable<NormalizedEvidenceRecord>;
  cancel?(job: SourceAcquisitionJob, context: AdapterRuntimeContext): Promise<void>;
}

export type MetricQuery = {
  clientId: string;
  sourceId: string;
  metricKeys: readonly string[];
  dimensions: readonly string[];
  since: string;
  until: string;
  filters?: Readonly<Record<string, string | readonly string[]>>;
};

export type NormalizedMetricPoint = {
  metricKey: string;
  value: number;
  observedAt: string;
  dimensions: Readonly<Record<string, string>>;
  provenance: Readonly<Record<string, string>>;
};

export interface MetricSourceAdapter {
  readonly id: string;
  query(query: MetricQuery, context: AdapterRuntimeContext): Promise<readonly NormalizedMetricPoint[]>;
}

export type DeliveryRequest = {
  clientId: string;
  destinationId: string;
  artifactId: string;
  artifactVersion: number;
  idempotencyKey: string;
};

export type DeliveryReceipt = {
  destinationId: string;
  status: "delivered" | "failed";
  externalReference?: string;
  errorCode?: string;
  completedAt: string;
};

export interface DeliveryAdapter {
  readonly id: string;
  deliver(request: DeliveryRequest, context: AdapterRuntimeContext): Promise<DeliveryReceipt>;
}
