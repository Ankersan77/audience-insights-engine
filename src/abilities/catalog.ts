import type { AbilityManifest } from "../core/contracts.ts";

const commonRubric = [
  "Every material claim cites applicable evidence",
  "Contradictions and uncertainty remain visible",
  "Attitude, behavior, demand, and causality are not conflated",
  "The recommendation identifies the next decision",
];

export const DECISION_BRIEF_ABILITIES: readonly AbilityManifest[] = [
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
      { sourceClasses: ["official_or_public", "public_conversation", "first_party_aggregate"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 180, minimumGrade: "C", requiredDimensions: ["market"] },
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
      { sourceClasses: ["client_owned"], minimumItems: 1, minimumSourceDiversity: 1, minimumGrade: "C", requiredDimensions: ["market"] },
      { sourceClasses: ["commissioned_or_licensed", "official_or_public", "first_party_aggregate"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 730, minimumGrade: "C", requiredDimensions: ["market"] },
    ],
    method: "Keep current brand law separate from proposed positioning evolution and test both against evidence.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["brand-law-change", "material-recommendation"],
    enabledByDefault: true,
  },
  {
    id: "cultural-trend-intelligence",
    version: "1.0.0",
    intent: "Separate emerging cultural, regulatory and technology patterns from transient conversation noise and assess client relevance.",
    evidenceRequirements: [
      { sourceClasses: ["official_or_public", "public_conversation", "commissioned_or_licensed"], minimumItems: 2, minimumSourceDiversity: 2, maximumAgeDays: 90, minimumGrade: "C", requiredDimensions: ["market"] },
    ],
    method: "Triangulate recent patterns, known seasonality, source bias and client applicability without treating conversation as behavior or demand.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["material-recommendation"],
    enabledByDefault: true,
  },
  {
    id: "research-planning",
    version: "1.0.0",
    intent: "Identify the decision-critical knowledge gap and propose the smallest responsible study that can resolve it.",
    evidenceRequirements: [
      { sourceClasses: ["client_owned", "commissioned_or_licensed", "official_or_public", "first_party_aggregate", "primary_research"], minimumItems: 1, minimumSourceDiversity: 1, minimumGrade: "C", requiredDimensions: ["market"] },
    ],
    method: "State the decision, map current evidence and uncertainty, then select the least burdensome valid desk, qualitative, quantitative or experimental method.",
    outputContract: "decision-brief@1",
    qualityRubric: commonRubric,
    humanGates: ["research-commission", "material-recommendation"],
    enabledByDefault: true,
  },
] as const;

export const SPECIALIZED_ABILITIES: readonly AbilityManifest[] = [
  {
    id: "campaign-preflight",
    version: "1.0.0",
    intent: "Evaluate a proposed campaign against strategy, brand, audience evidence, execution constraints and measurement readiness.",
    evidenceRequirements: [
      { sourceClasses: ["client_owned", "commissioned_or_licensed", "official_or_public"], minimumItems: 1, minimumSourceDiversity: 1, minimumGrade: "C", requiredDimensions: ["market"] },
    ],
    method: "Assess fit, assumptions, alternatives, risks and measurement readiness against the frozen campaign revision.",
    outputContract: "campaign-assessment@1",
    qualityRubric: commonRubric,
    humanGates: ["campaign-approval"],
    enabledByDefault: true,
  },
  {
    id: "live-campaign-intelligence",
    version: "1.0.0",
    intent: "Compare active-campaign delivery and response with compatible baselines while keeping optimization ideas non-causal.",
    evidenceRequirements: [
      { sourceClasses: ["first_party_aggregate"], minimumItems: 1, minimumSourceDiversity: 1, maximumAgeDays: 14, minimumGrade: "C", requiredDimensions: ["campaign"] },
    ],
    method: "Evaluate compatible planned metrics, anomalies and context changes; express interim recommendations as hypotheses.",
    outputContract: "campaign-assessment@1",
    qualityRubric: commonRubric,
    humanGates: ["campaign-optimization"],
    enabledByDefault: true,
  },
  {
    id: "post-campaign-learning",
    version: "1.0.0",
    intent: "Read completed results against the approved plan and produce conditional candidate learning with explicit causal limits.",
    evidenceRequirements: [
      { sourceClasses: ["first_party_aggregate", "primary_research"], minimumItems: 1, minimumSourceDiversity: 1, minimumGrade: "C", requiredDimensions: ["campaign"] },
    ],
    method: "Join the frozen plan, result evidence, data-quality checks and alternative explanations before proposing learning.",
    outputContract: "campaign-assessment@1",
    qualityRubric: commonRubric,
    humanGates: ["learning-review"],
    enabledByDefault: true,
  },
  {
    id: "brand-lift-study",
    version: "1.0.0",
    intent: "Design, classify and analyze a defensible Brand Lift study without overstating causal support.",
    evidenceRequirements: [
      { sourceClasses: ["primary_research", "commissioned_or_licensed", "first_party_aggregate"], minimumItems: 1, minimumSourceDiversity: 1, minimumGrade: "C", requiredDimensions: ["campaign"] },
    ],
    method: "Pre-register outcomes and interpretation, verify treatment/control integrity, power, fieldwork, weighting and uncertainty, then classify the strongest valid claim.",
    outputContract: "study-report@1",
    qualityRubric: commonRubric,
    humanGates: ["method-review", "result-language-review"],
    enabledByDefault: true,
  },
] as const;

export const ABILITY_CATALOG: readonly AbilityManifest[] = [...DECISION_BRIEF_ABILITIES, ...SPECIALIZED_ABILITIES];

/** Compatibility alias for code that means all installed Core capability packages. */
export const CORE_ABILITIES = ABILITY_CATALOG;

export function getAbility(id: string, version?: string): AbilityManifest | null {
  return ABILITY_CATALOG.find((ability) => ability.id === id && (!version || ability.version === version)) ?? null;
}

export function getDecisionBriefAbility(id: string, version?: string): AbilityManifest | null {
  return DECISION_BRIEF_ABILITIES.find((ability) => ability.id === id && (!version || ability.version === version)) ?? null;
}
