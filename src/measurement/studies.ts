import type { StudyClassification, StudyDesign } from "../core/contracts.ts";

export function classifyStudy(design: StudyDesign): StudyClassification {
  const missing: string[] = [];
  if (!design.outcomeInstrument.trim()) missing.push("A defined outcome instrument is required.");
  if (!design.fieldworkWindow) missing.push("A fieldwork window is required.");

  const causalRequirements = [
    [design.hasTreatmentGroup, "A treatment group is required."],
    [design.hasControlGroup, "A control group is required."],
    [design.assignment === "randomized" || design.assignment === "matched", "Randomized or defensible matched assignment is required."],
    [design.preregistered, "The primary analysis must be preregistered."],
    [design.contaminationRisk === "low", "Contamination risk must be assessed as low."],
    [(design.sampleSizeTreatment ?? 0) >= 100 && (design.sampleSizeControl ?? 0) >= 100, "Both groups need a feasible sample."],
  ] as const;
  const causalMissing = causalRequirements.filter(([passed]) => !passed).map(([, message]) => message);

  if (design.requestedClaim === "brand_lift") {
    const allMissing = [...missing, ...causalMissing];
    return allMissing.length === 0
      ? { classification: "causal", strongestAllowedClaim: "Incremental Brand Lift within the preregistered population, outcomes, and fieldwork window.", missingRequirements: [], mayUseBrandLiftTerm: true }
      : { classification: "inconclusive", strongestAllowedClaim: "No causal Brand Lift claim is supported by the proposed design.", missingRequirements: allMissing, mayUseBrandLiftTerm: false };
  }

  if (design.hasTreatmentGroup && design.hasControlGroup && design.assignment !== "none") {
    return { classification: "directional", strongestAllowedClaim: "A directional difference between the defined groups, subject to selection and contamination limits.", missingRequirements: missing, mayUseBrandLiftTerm: false };
  }
  return {
    classification: "diagnostic",
    strongestAllowedClaim: "A descriptive change or association only; no incremental effect.",
    missingRequirements: missing,
    mayUseBrandLiftTerm: false,
  };
}

export type BinaryLiftResult = {
  status: "estimated" | "inconclusive";
  treatmentRate: number;
  controlRate: number;
  absoluteDifference: number;
  relativeDifference: number | null;
  confidenceInterval95: readonly [number, number];
  standardError: number;
  interpretation: string;
};

export function analyzeBinaryLift(input: {
  treatmentPositive: number;
  treatmentTotal: number;
  controlPositive: number;
  controlTotal: number;
  minimumPerGroup: number;
  contaminated?: boolean;
}): BinaryLiftResult {
  for (const [positive, total] of [
    [input.treatmentPositive, input.treatmentTotal],
    [input.controlPositive, input.controlTotal],
  ]) {
    if (!Number.isInteger(positive) || !Number.isInteger(total) || positive < 0 || total <= 0 || positive > total) {
      throw new Error("invalid binary outcome counts");
    }
  }
  const treatmentRate = input.treatmentPositive / input.treatmentTotal;
  const controlRate = input.controlPositive / input.controlTotal;
  const difference = treatmentRate - controlRate;
  const standardError = Math.sqrt(
    (treatmentRate * (1 - treatmentRate)) / input.treatmentTotal +
    (controlRate * (1 - controlRate)) / input.controlTotal,
  );
  const confidenceInterval95: [number, number] = [difference - 1.96 * standardError, difference + 1.96 * standardError];
  const underpowered = input.treatmentTotal < input.minimumPerGroup || input.controlTotal < input.minimumPerGroup;
  const crossesZero = confidenceInterval95[0] <= 0 && confidenceInterval95[1] >= 0;
  const status = underpowered || input.contaminated || crossesZero ? "inconclusive" : "estimated";
  const reason = underpowered
    ? "The planned minimum sample was not reached."
    : input.contaminated
      ? "The groups were contaminated."
      : crossesZero
        ? "The uncertainty interval includes no difference."
        : "The estimate excludes no difference under the declared design assumptions.";
  return {
    status,
    treatmentRate,
    controlRate,
    absoluteDifference: difference,
    relativeDifference: controlRate === 0 ? null : difference / controlRate,
    confidenceInterval95,
    standardError,
    interpretation: reason,
  };
}
