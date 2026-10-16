import type { EvidenceItem, EvidenceRequirement } from "../core/contracts.ts";

export type EvidenceSelectionBasis = {
  evidenceId: string;
  included: boolean;
  score: number;
  reasons: readonly string[];
};

export type EvidenceResolution = {
  selected: readonly EvidenceItem[];
  basis: readonly EvidenceSelectionBasis[];
  sufficient: boolean;
  gaps: readonly string[];
};

const GRADE_SCORE = { A: 4, B: 3, C: 2, D: 1, ungraded: 0 } as const;

function daysBetween(older: string, newer: string): number {
  return Math.max(0, (new Date(newer).getTime() - new Date(older).getTime()) / 86_400_000);
}

function hasRequiredDimensions(item: EvidenceItem, requirement: EvidenceRequirement): boolean {
  return requirement.requiredDimensions.every((dimension) => {
    if (dimension === "market") return item.applicability.markets.length > 0;
    if (dimension === "language") return item.applicability.languages.length > 0;
    if (dimension === "category") return item.applicability.categories.length > 0;
    if (dimension === "audience") return item.applicability.audiences.length > 0;
    if (dimension === "campaign") return item.applicability.campaigns.length > 0;
    return false;
  });
}

export function resolveEvidence(input: {
  clientId: string;
  now: string;
  requirements: readonly EvidenceRequirement[];
  evidence: readonly EvidenceItem[];
  market?: string;
  language?: string;
}): EvidenceResolution {
  const basis: EvidenceSelectionBasis[] = [];
  const candidates: { item: EvidenceItem; score: number }[] = [];

  for (const item of input.evidence) {
    const reasons: string[] = [];
    let score = 0;
    if (item.clientId !== input.clientId) reasons.push("different-client");
    if (item.lifecycle !== "live" && item.lifecycle !== "candidate") reasons.push(`lifecycle-${item.lifecycle}`);
    if (!item.rights.commercialUse) reasons.push("rights-do-not-permit-use");
    if (new Date(item.expiresAt) <= new Date(input.now)) reasons.push("expired");
    if (item.sensitive || item.identityRisk) reasons.push("sensitive-or-identity-risk");
    if (input.market && item.applicability.markets.length > 0 && !item.applicability.markets.includes(input.market)) {
      reasons.push("market-not-applicable");
    }
    if (input.language && item.applicability.languages.length > 0 && !item.applicability.languages.includes(input.language)) {
      reasons.push("language-not-applicable");
    }

    const sourceCompatible = input.requirements.filter((requirement) =>
      requirement.sourceClasses.includes(item.sourceClass),
    );
    const compatibleRequirement = sourceCompatible.find((requirement) => hasRequiredDimensions(item, requirement));
    if (sourceCompatible.length === 0) reasons.push("source-class-not-required");
    else if (!compatibleRequirement) reasons.push("missing-required-applicability-dimension");
    if (compatibleRequirement?.maximumAgeDays !== undefined) {
      const observed = item.observedAt ?? item.publishedAt ?? item.ingestedAt;
      if (daysBetween(observed, input.now) > compatibleRequirement.maximumAgeDays) reasons.push("stale");
    }
    if (compatibleRequirement?.minimumGrade && GRADE_SCORE[item.grade] < GRADE_SCORE[compatibleRequirement.minimumGrade]) {
      reasons.push("grade-below-minimum");
    }

    if (reasons.length === 0) {
      score = item.confidence * 10 + GRADE_SCORE[item.grade] + (item.lifecycle === "live" ? 2 : 0);
      candidates.push({ item, score });
    }
    basis.push({ evidenceId: item.id, included: reasons.length === 0, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const selected = candidates.map((candidate) => candidate.item);
  const gaps: string[] = [];
  for (const requirement of input.requirements) {
    const matching = selected.filter((item) => requirement.sourceClasses.includes(item.sourceClass) && hasRequiredDimensions(item, requirement));
    if (matching.length < requirement.minimumItems) {
      gaps.push(`needs ${requirement.minimumItems - matching.length} more item(s) from ${requirement.sourceClasses.join("/")}`);
    }
    const diversity = new Set(matching.map((item) => item.sourceConnectionId)).size;
    if (diversity < requirement.minimumSourceDiversity) {
      gaps.push(`needs ${requirement.minimumSourceDiversity - diversity} more independent source(s)`);
    }
  }

  return { selected, basis, sufficient: gaps.length === 0, gaps };
}
