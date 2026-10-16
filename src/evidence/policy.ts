import { createHash } from "node:crypto";
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
};

const IDENTIFIER_PATTERNS: readonly { name: string; pattern: RegExp; replacement: string }[] = [
  { name: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[redacted-email]" },
  { name: "social-handle", pattern: /(^|\s)@[a-z0-9_.-]{2,32}\b/gi, replacement: "$1[redacted-handle]" },
  { name: "forum-handle", pattern: /\b(?:u|user)\/[a-z0-9_-]{2,32}\b/gi, replacement: "[redacted-handle]" },
  { name: "profile-url", pattern: /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|instagram\.com|tiktok\.com|reddit\.com\/user)\/[^\s)]+/gi, replacement: "[redacted-profile-url]" },
  { name: "device-id", pattern: /\b(?:device|advertising|cookie)[-_ ]?id\s*[:=]\s*[a-z0-9-]{8,}\b/gi, replacement: "[redacted-device-id]" },
];

const INJECTION_PATTERNS = [
  /ignore (?:all|any|the) previous instructions/i,
  /system prompt/i,
  /you are now/i,
  /developer message/i,
  /execute (?:this|the following) command/i,
];

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

export function redactIdentifiers(content: string): { content: string; redactions: string[]; identityRisk: boolean } {
  let redacted = content;
  const redactions: string[] = [];
  for (const rule of IDENTIFIER_PATTERNS) {
    const replaced = redacted.replace(rule.pattern, rule.replacement);
    if (replaced !== redacted) redactions.push(rule.name);
    redacted = replaced;
  }
  return { content: redacted, redactions, identityRisk: redactions.length > 0 };
}

export function hasPromptInjection(content: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(content));
}

export function retainEvidence(candidate: EvidenceCandidate, policy: EvidencePolicy): EvidenceItem {
  const redacted = redactIdentifiers(candidate.content);
  const redactedSynthesis = candidate.synthesis ? redactIdentifiers(candidate.synthesis) : undefined;
  const sourceUrl = safeSourceUrl(candidate.sourceUrl);
  const identityRisk = redacted.identityRisk || Boolean(redactedSynthesis?.identityRisk) || sourceUrl.identityRisk;
  const sensitive = policy.sensitiveTerms.some((term) =>
    redacted.content.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
  );
  const cohortSuppressed = candidate.cohortSize !== undefined && candidate.cohortSize < policy.minimumCohortSize;
  const unsafeVerbatim = candidate.citationLevel === "verbatim" &&
    (!policy.allowVerbatim || identityRisk || !candidate.rights.quotationAllowed);
  const injectionRisk = hasPromptInjection(redacted.content);
  const rightsExpired = Boolean(candidate.rights.expiresAt) &&
    new Date(candidate.rights.expiresAt!).getTime() <= new Date(candidate.ingestedAt).getTime();
  const lifecycle = sensitive || cohortSuppressed || unsafeVerbatim || injectionRisk || !candidate.rights.commercialUse || rightsExpired
    ? "quarantined"
    : "candidate";
  const safeContent = cohortSuppressed ? "[suppressed: cohort below configured minimum]" : redacted.content;

  return {
    id: candidate.id,
    clientId: candidate.clientId,
    collectionId: candidate.collectionId,
    sourceConnectionId: candidate.sourceConnectionId,
    sourceClass: candidate.sourceClass,
    externalReference: candidate.externalReference,
    sourceUrl: identityRisk ? undefined : sourceUrl.value,
    sourceContent: safeContent,
    synthesis: redactedSynthesis?.content,
    publishedAt: candidate.publishedAt,
    observedAt: candidate.observedAt,
    ingestedAt: candidate.ingestedAt,
    expiresAt: addDays(candidate.ingestedAt, policy.retainedEvidenceDays),
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
