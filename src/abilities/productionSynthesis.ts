import type { ResearchSynthesisProvider } from "./synthesis.ts";

/**
 * Deployment seam for an approved synthesis adapter. It intentionally returns
 * undefined until a provider, data-processing boundary, durable spend authority
 * and acceptance evidence have been configured. The optional Responses transport
 * in connectors/openaiSynthesis.ts does NOT authorize production calls or select
 * a vendor. Core returns needs_context until this integration is approved.
 */
export function getProductionSynthesisProvider(): ResearchSynthesisProvider | undefined {
  return undefined;
}

