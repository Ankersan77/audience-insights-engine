import type { ResearchSynthesisProvider } from "@/src/abilities/synthesis";
import { withSynthesisBudget } from "@/src/abilities/governedSynthesis";
import { OpenAIResearchSynthesisProvider, openAISynthesisVersion } from "@/src/connectors/openaiSynthesis";
import { parseSynthesisConfiguration, synthesisBindingDigest } from "@/src/connectors/synthesisConfiguration";
import { dispatchSynthesisAttempt, finishSynthesisAttempt, reserveSynthesisAttempt } from "@/src/db/queries/synthesis_budget";
import { synthesisAuthorityGuard } from "@/src/db/queries/synthesis_authority";

/** Server composition root. Overrides are code-only test seams, never request fields.
 * No configured/valid binding means no provider, credential lookup or network call.
 */
export function getProductionSynthesisProvider(clientId: number, options: {
  signal?: AbortSignal;
  environment?: () => Readonly<Record<string, string | undefined>>;
  transport?: typeof fetch;
} = {}): ResearchSynthesisProvider | undefined {
  const environment = options.environment ?? (() => process.env);
  let binding;
  try {
    binding = parseSynthesisConfiguration(environment().MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON, String(clientId));
  } catch { return undefined; }
  if (!binding) return undefined;
  const approved = binding;
  const digest = synthesisBindingDigest(approved);
  const version = openAISynthesisVersion(approved.model);
  const assertConfiguration = () => {
    const current = parseSynthesisConfiguration(environment().MARKET_RESEARCH_SYNTHESIS_BINDINGS_JSON, String(clientId));
    if (!current || synthesisBindingDigest(current) !== digest || environment().ENABLE_ENV_CREDENTIAL_RESOLVER !== "true") throw new Error("synthesis-configuration-changed-or-disabled");
  };
  return {
    id: approved.adapterId, version,
    async synthesize(input) {
      const guard = synthesisAuthorityGuard(input, approved, assertConfiguration);
      return withSynthesisBudget({ id: approved.adapterId, version, signal: options.signal,
        plan: () => ({ currency: approved.currency, maxCostMicros: approved.maxCostMicros, providerId: approved.adapterId,
          providerVersion: version, model: approved.model, approvalReference: `synthesis:${digest}`, bindingExpiresAt: approved.expiresAt,
          maxInputBytes: approved.maxInputBytes, maxOutputTokens: approved.maxOutputTokens, maxDurationMs: approved.timeoutMs }),
        ledger: {
          reserve: (attempt) => reserveSynthesisAttempt(attempt, guard),
          dispatch: (permit) => dispatchSynthesisAttempt(permit, guard),
          finish: (permit, outcome) => finishSynthesisAttempt(permit, outcome, guard),
        },
        async createProvider({ signal }) {
          assertConfiguration();
          // Deliberately AFTER durable admission and one-use dispatch. No global key fallback.
          const apiKey = environment()[approved.credentialEnv];
          if (!apiKey) throw new Error("synthesis-credential-unavailable");
          return new OpenAIResearchSynthesisProvider({ binding: approved, apiKey, transport: options.transport, signal });
        },
      }).synthesize(input);
    },
  };
}
