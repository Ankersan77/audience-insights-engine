import type { SourceAcquisitionJob } from "../connectors/contracts.ts";
import type { Applicability, MethodDeclaration, RightsDeclaration, SourceClass } from "../core/contracts.ts";
import { EvidenceAdapter, type AdapterRunContext } from "./sdk.ts";
import type { EvidenceCandidate } from "./policy.ts";

type CommonFixture = {
  id: string;
  content: string;
  rights: RightsDeclaration;
  method: MethodDeclaration;
  applicability: Applicability;
  confidence?: number;
};

function candidate(
  raw: CommonFixture,
  job: SourceAcquisitionJob,
  context: AdapterRunContext,
  overrides: Partial<EvidenceCandidate>,
): EvidenceCandidate {
  return {
    id: `${job.id}:${raw.id}`,
    clientId: job.clientId,
    collectionId: `${job.id}:collection`,
    sourceConnectionId: job.sourceId,
    sourceClass: "client_owned",
    externalReference: raw.id,
    content: raw.content,
    ingestedAt: context.now,
    citationLevel: "paraphrased",
    rights: raw.rights,
    method: raw.method,
    applicability: raw.applicability,
    confidence: raw.confidence ?? 0.7,
    grade: "ungraded",
    ...overrides,
  };
}

export class DocumentEvidenceAdapter extends EvidenceAdapter<CommonFixture & { title: string; sourceUrl?: string }> {
  readonly id = "document-evidence";
  private readonly records: readonly (CommonFixture & { title: string; sourceUrl?: string })[];
  private readonly sourceClass: Extract<SourceClass, "client_owned" | "commissioned_or_licensed" | "primary_research">;
  constructor(
    records: readonly (CommonFixture & { title: string; sourceUrl?: string })[],
    sourceClass: Extract<SourceClass, "client_owned" | "commissioned_or_licensed" | "primary_research"> = "client_owned",
  ) {
    super();
    this.records = records;
    this.sourceClass = sourceClass;
  }
  protected async acquireRaw(): Promise<readonly (CommonFixture & { title: string; sourceUrl?: string })[]> { return this.records; }
  protected normalize(raw: CommonFixture & { title: string; sourceUrl?: string }, job: SourceAcquisitionJob, context: AdapterRunContext) {
    return candidate(raw, job, context, {
      sourceClass: this.sourceClass,
      synthesis: raw.title,
      sourceUrl: raw.sourceUrl,
      grade: "B",
    });
  }
}

export class PublicWebEvidenceAdapter extends EvidenceAdapter<CommonFixture & { url: string; permitted: boolean }> {
  readonly id = "public-web-evidence";
  private readonly records: readonly (CommonFixture & { url: string; permitted: boolean })[];
  constructor(records: readonly (CommonFixture & { url: string; permitted: boolean })[]) { super(); this.records = records; }
  protected async acquireRaw(): Promise<readonly (CommonFixture & { url: string; permitted: boolean })[]> { return this.records; }
  protected normalize(raw: CommonFixture & { url: string; permitted: boolean }, job: SourceAcquisitionJob, context: AdapterRunContext) {
    if (!raw.permitted) return null;
    return candidate(raw, job, context, {
      sourceClass: "official_or_public",
      sourceUrl: raw.url,
      grade: "B",
    });
  }
}

type AggregateRecord = CommonFixture & { metric: string; value: number; unit: string; cohortSize: number; observedAt?: string; dimensions?: Readonly<Record<string, string>>; title?: string; sourceUrl?: string };
export class AggregateMetricEvidenceAdapter extends EvidenceAdapter<AggregateRecord> {
  readonly id = "aggregate-metric-evidence";
  private readonly records: readonly AggregateRecord[];
  constructor(records: readonly AggregateRecord[]) { super(); this.records = records; }
  protected async acquireRaw(): Promise<readonly AggregateRecord[]> { return this.records; }
  protected normalize(raw: AggregateRecord, job: SourceAcquisitionJob, context: AdapterRunContext) {
    return candidate(raw, job, context, {
      sourceClass: "first_party_aggregate",
      content: `${raw.metric}: ${raw.value} ${raw.unit}${raw.dimensions ? `\n${raw.content}\n${JSON.stringify({ dimensions: raw.dimensions, method: raw.method, cohortSize: raw.cohortSize })}` : ""}`,
      synthesis: raw.title,
      sourceUrl: raw.sourceUrl,
      observedAt: raw.observedAt,
      citationLevel: "statistical",
      cohortSize: raw.cohortSize,
      grade: "A",
      quantitative: { metricKey: raw.metric, value: raw.value, unit: raw.unit, observedAt: raw.observedAt ?? context.now, dimensions: raw.dimensions ?? {}, cohortSize: raw.cohortSize },
    });
  }
}

export class PublicConversationThemeAdapter extends EvidenceAdapter<CommonFixture & { occurrenceCount: number; sourceDiversity: number }> {
  readonly id = "public-conversation-theme";
  private readonly records: readonly (CommonFixture & { occurrenceCount: number; sourceDiversity: number })[];
  constructor(records: readonly (CommonFixture & { occurrenceCount: number; sourceDiversity: number })[]) { super(); this.records = records; }
  protected async acquireRaw(): Promise<readonly (CommonFixture & { occurrenceCount: number; sourceDiversity: number })[]> { return this.records; }
  protected normalize(raw: CommonFixture & { occurrenceCount: number; sourceDiversity: number }, job: SourceAcquisitionJob, context: AdapterRunContext) {
    if (raw.occurrenceCount < 2 || raw.sourceDiversity < 2) return null;
    return candidate(raw, job, context, {
      sourceClass: "public_conversation",
      content: raw.content,
      citationLevel: "paraphrased",
      cohortSize: raw.occurrenceCount,
      grade: "C",
      qualitative: { label: raw.content.slice(0, 120), paraphrase: raw.content, occurrenceCount: raw.occurrenceCount, sourceDiversity: raw.sourceDiversity, method: raw.method.method },
    });
  }
}
