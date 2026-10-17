import { createHash } from "node:crypto";
import { hasPromptInjection, redactIdentifiers } from "./textSafety.ts";
export { hasPromptInjection, redactIdentifiers } from "./textSafety.ts";
import type {
  Applicability,
  CitationLevel,
  EvidenceGrade,
  EvidenceItem,
  MethodDeclaration,
  RightsDeclaration,
  SourceClass,
} from "../core/contracts.ts";

export type EvidencePolicy = {
  minimumCohortSize: number;
  retainedEvidenceDays: number;
  allowVerbatim: boolean;
  sensitiveTerms: readonly string[];
};

export type EvidenceCandidate = {
  id: string;
  clientId: string;
  collectionId: string;
  sourceConnectionId: string;
  sourceClass: SourceClass;
  externalReference: string;
  sourceUrl?: string;
  content: string;
  synthesis?: string;
  publishedAt?: string;
  observedAt?: string;
  ingestedAt: string;
  citationLevel: CitationLevel;
  rights: RightsDeclaration;
  method: MethodDeclaration;
  applicability: Applicability;
  confidence: number;
  grade: EvidenceGrade;
  cohortSize?: number;
  quantitative?: { metricKey: string; value: number; unit: string; observedAt: string; dimensions: Readonly<Record<string, string>>; cohortSize?: number };
  qualitative?: { label: string; paraphrase: string; occurrenceCount: number; sourceDiversity: number; method: string };
};

const PERSON_PROFILE_URL = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|instagram\.com|tiktok\.com)\/[a-z0-9_.-]+\/?(?:[?#].*)?$/i;

function safeSourceUrl(value: string | undefined): { value?: string; redacted: boolean; identityRisk: boolean } {
  if (!value) return { redacted: false, identityRisk: false };
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || PERSON_PROFILE_URL.test(value)) {
      return { redacted: true, identityRisk: true };
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return { value: parsed.toString(), redacted: parsed.toString() !== value, identityRisk: false };
  } catch {
    return { redacted: true, identityRisk: true };
  }
}

function addDays(iso: string, days: number): string {
  const value = new Date(iso);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

export function retainEvidence(candidate: EvidenceCandidate, policy: EvidencePolicy): EvidenceItem {
  const redacted = redactIdentifiers(candidate.content);
  const redactedSynthesis = candidate.synthesis ? redactIdentifiers(candidate.synthesis) : undefined;
  const redactedReference = redactIdentifiers(candidate.externalReference);
  const sourceUrl = safeSourceUrl(candidate.sourceUrl);
  const identityRisk = redacted.identityRisk || Boolean(redactedSynthesis?.identityRisk) || redactedReference.identityRisk || sourceUrl.identityRisk;
  const sensitive = policy.sensitiveTerms.some((term) =>
    redacted.content.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
  );
  const cohortSuppressed = candidate.cohortSize !== undefined && candidate.cohortSize < policy.minimumCohortSize;
  const unsafeVerbatim = candidate.citationLevel === "verbatim" &&
    (!policy.allowVerbatim || identityRisk || !candidate.rights.quotationAllowed);
  const injectionRisk = hasPromptInjection(redacted.content);
  const rightsExpired = Boolean(candidate.rights.expiresAt) &&
    new Date(candidate.rights.expiresAt!).getTime() <= new Date(candidate.ingestedAt).getTime();
  const lifecycle = sensitive || identityRisk || cohortSuppressed || unsafeVerbatim || injectionRisk || !candidate.rights.commercialUse || rightsExpired
    ? "quarantined"
    : "candidate";
  const safeContent = cohortSuppressed ? "[suppressed: cohort below configured minimum]" : redacted.content;
  const retentionExpiry = addDays(candidate.ingestedAt, policy.retainedEvidenceDays);
  const rightsExpiry = candidate.rights.expiresAt && Number.isFinite(Date.parse(candidate.rights.expiresAt))
    ? candidate.rights.expiresAt
    : undefined;
  const expiresAt = rightsExpiry && Date.parse(rightsExpiry) < Date.parse(retentionExpiry) ? rightsExpiry : retentionExpiry;
  const externalReference = redactedReference.identityRisk
    ? `evidence-ref:${createHash("sha256").update(`${candidate.sourceConnectionId}\u0000${candidate.externalReference}`).digest("hex").slice(0, 24)}`
    : redactedReference.content.slice(0, 512);

  return {
    id: candidate.id,
    clientId: candidate.clientId,
    collectionId: candidate.collectionId,
    sourceConnectionId: candidate.sourceConnectionId,
    sourceClass: candidate.sourceClass,
    externalReference,
    sourceUrl: identityRisk ? undefined : sourceUrl.value,
    sourceContent: safeContent,
    synthesis: redactedSynthesis?.content,
    publishedAt: candidate.publishedAt,
    observedAt: candidate.observedAt,
    ingestedAt: candidate.ingestedAt,
    expiresAt,
    lifecycle,
    citationLevel: candidate.citationLevel,
    rights: candidate.rights,
    method: candidate.method,
    applicability: candidate.applicability,
    confidence: candidate.confidence,
    grade: candidate.grade,
    sensitive,
    identityRisk,
    redactions: [
      ...redacted.redactions,
      ...(redactedSynthesis?.redactions.map((name) => `synthesis-${name}`) ?? []),
      ...(redactedReference.redactions.map((name) => `external-reference-${name}`)),
      ...(sourceUrl.redacted ? ["source-url"] : []),
      ...(cohortSuppressed ? ["small-cohort"] : []),
      ...(injectionRisk ? ["prompt-injection"] : []),
      ...(rightsExpired ? ["rights-expired"] : []),
    ],
    contentHash: createHash("sha256").update(safeContent).digest("hex"),
  };
}

export function assertPeopleBlind(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const forbiddenKey of [
    "authorHandle",
    "author_handle",
    "profileId",
    "profile_id",
    "avatar",
    "deviceId",
    "device_id",
    "cookieId",
    "cookie_id",
  ]) {
    if (serialized.includes(`\"${forbiddenKey}\"`)) {
      throw new Error(`people-blind-boundary: forbidden field ${forbiddenKey}`);
    }
  }
}
