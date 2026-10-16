import type { ResearchSynthesisProvider } from "./synthesis.ts";

/**
 * Deployment seam for an approved synthesis adapter. It intentionally returns
 * undefined until a provider, data-processing boundary and acceptance evidence
 * have been configured; Core then returns needs_context instead of fake prose.
 */
export function getProductionSynthesisProvider(): ResearchSynthesisProvider | undefined {
  return undefined;
}

