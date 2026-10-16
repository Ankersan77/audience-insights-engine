import type { AbilityManifest } from "../core/contracts.ts";

const commonRubric = [
  "Every material claim cites applicable evidence",
  "Contradictions and uncertainty remain visible",
  "Attitude, behavior, demand, and causality are not conflated",
  "The recommendation identifies the next decision",
];

export const CORE_ABILITIES: readonly AbilityManifest[] = [
  {
    id: "market-category-diagnosis",
    version: "1.0.0",
    intent: "Explain material market/category structure and change for a client decision.",
    evidenceRequirements: [
      { sourceClasses: ["official_or_public", "commissioned_or_licensed"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 365, minimumGrade: "C", requiredDimensions: ["market"] },
    ],
    method: "Triangulate market structure, demand proxies, seasonality, price, availability and external forces.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["material-recommendation"],
    enabledByDefault: true,
  },
  {
    id: "audience-purchase-behavior",
    version: "1.0.0",
    intent: "Synthesize segments, needs, occasions, journeys, barriers and observed purchase behavior.",
    evidenceRequirements: [
      { sourceClasses: ["commissioned_or_licensed", "first_party_aggregate", "primary_research"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 730, minimumGrade: "C", requiredDimensions: ["audience"] },
    ],
    method: "Separate stated attitude, observed behavior and modeled inference before synthesis.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["audience-definition-change", "material-recommendation"],
    enabledByDefault: true,
  },
  {
    id: "competitor-intelligence",
    version: "1.0.0",
    intent: "Identify meaningful competitor and substitute moves using source-backed comparison.",
    evidenceRequirements: [
      { sourceClasses: ["official_or_public", "public_conversation", "first_party_aggregate"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 180, minimumGrade: "C", requiredDimensions: ["competitor"] },
    ],
    method: "Compare claims, products, price, distribution, creative patterns and response over a declared period.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["material-recommendation"],
    enabledByDefault: true,
  },
  {
    id: "brand-positioning-diagnosis",
    version: "1.0.0",
    intent: "Diagnose current positioning and bounded evolution choices against market evidence and brand law.",
    evidenceRequirements: [
      { sourceClasses: ["client_owned"], minimumItems: 1, minimumSourceDiversity: 1, minimumGrade: "C", requiredDimensions: ["brand"] },
      { sourceClasses: ["commissioned_or_licensed", "official_or_public", "first_party_aggregate"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 730, minimumGrade: "C", requiredDimensions: ["market"] },
    ],
    method: "Keep current brand law separate from proposed positioning evolution and test both against evidence.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["brand-law-change", "material-recommendation"],
    enabledByDefault: true,
  },
] as const;

export function getAbility(id: string, version?: string): AbilityManifest | null {
  return CORE_ABILITIES.find((ability) => ability.id === id && (!version || ability.version === version)) ?? null;
}
