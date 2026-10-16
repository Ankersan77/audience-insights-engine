import type { SourceClass } from "../core/contracts.ts";
import type { ResearchSynthesisInput, ResearchSynthesisProvider } from "../abilities/synthesis.ts";
import { getDecisionBriefAbility } from "../abilities/catalog.ts";
import { RESEARCH_SYNTHESIS_SCHEMA, researchSynthesisPrompt, SYNTHESIS_PROMPT_VERSION } from "../abilities/synthesisPrompt.ts";
import { assertPeopleBlind, redactIdentifiers } from "../evidence/policy.ts";

const ENDPOINT = "https://api.openai.com/v1/responses";
const SOURCE_CLASSES: readonly SourceClass[] = ["client_owned", "first_party_aggregate", "commissioned_or_licensed", "official_or_public", "public_conversation", "primary_research"];

/** Server-owned acceptance record; never accept these fields from an API caller.
 * A reference is not independent proof of an account's retention configuration.
 */
export type OpenAISynthesisBinding = {
  clientId: string;
  model: string;
  abilityIds: readonly string[];
  markets: readonly string[];
  languages: readonly string[];
  allowedSourceClasses: readonly SourceClass[];
  approvalReference: string;
  expiresAt: string;
  retention: "zero_data_retention" | "standard_api_store_false";
  maxInputBytes: number;
  maxOutputTokens: number;
  maxResponseBytes: number;
  timeoutMs: number;
};

export type SynthesisAdapterErrorCode = "binding-invalid" | "binding-expired" | "scope-denied" | "input-invalid" | "input-too-large" | "response-too-large" | "provider-failed" | "response-invalid" | "timeout";

/** Never surface provider response bodies, request contents or credential values. */
export class SynthesisAdapterError extends Error {
  readonly code: SynthesisAdapterErrorCode;
  constructor(code: SynthesisAdapterErrorCode) {
    super(`research-synthesis:${code}`);
    this.code = code;
    this.name = "SynthesisAdapterError";
  }
}

function fail(code: SynthesisAdapterErrorCode): never { throw new SynthesisAdapterError(code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("response-invalid");
  return value as Record<string, unknown>;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && value.every((item) => typeof item === "string" && item.trim() === item && item.length > 0 && item.length <= 200);
}
function integer(value: number, min: number, max: number) { return Number.isSafeInteger(value) && value >= min && value <= max; }

function validateBinding(binding: OpenAISynthesisBinding) {
  if (!binding || typeof binding.clientId !== "string" || !binding.clientId.trim() || binding.clientId.length > 200
    || typeof binding.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(binding.model)
    || !strings(binding.abilityIds) || binding.abilityIds.some((id) => !getDecisionBriefAbility(id))
    || !strings(binding.markets) || !strings(binding.languages) || !strings(binding.allowedSourceClasses)
    || binding.allowedSourceClasses.some((value) => !SOURCE_CLASSES.includes(value))
    || typeof binding.approvalReference !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(binding.approvalReference)
    || !["zero_data_retention", "standard_api_store_false"].includes(binding.retention)
    || typeof binding.expiresAt !== "string" || !Number.isFinite(Date.parse(binding.expiresAt))
    || !integer(binding.maxInputBytes, 1_024, 1_000_000) || !integer(binding.maxOutputTokens, 256, 32_768)
    || !integer(binding.maxResponseBytes, 1_024, 2_000_000) || !integer(binding.timeoutMs, 1, 120_000)) fail("binding-invalid");
}

async function readBoundedResponse(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => {});
    fail("response-too-large");
  }
  if (!response.body) fail("response-invalid");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (signal.aborted) { abort(); fail("timeout"); }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { void reader.cancel().catch(() => {}); fail("response-too-large"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

function analysisFromResponse(value: unknown): unknown {
  const response = object(value);
  if (response.status !== "completed" || response.error || response.incomplete_details || !Array.isArray(response.output)) fail("response-invalid");
  const messages: Record<string, unknown>[] = [];
  for (const raw of response.output) {
    const item = object(raw);
    if (item.type === "reasoning") continue; // Never expose or retain reasoning.
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed") fail("response-invalid");
    messages.push(item);
  }
  if (messages.length !== 1) fail("response-invalid");
  const content = messages[0].content;
  if (!Array.isArray(content) || content.length !== 1) fail("response-invalid");
  const part = object(content[0]);
  if (part.type !== "output_text" || typeof part.text !== "string") fail("response-invalid");
  // No regex extraction/repair or second paid request on malformed/refused output.
  return JSON.parse(part.text);
}

/** Optional transport, not installed by getProductionSynthesisProvider.
 * Call only behind Core's evidence, permission and durable spend authorization.
 * No implicit environment keys, model defaults, tools, retries or fallback clients.
 */
export class OpenAIResearchSynthesisProvider implements ResearchSynthesisProvider {
  readonly id = "openai-responses";
  readonly version: string;
  #binding: OpenAISynthesisBinding;
  #apiKey: string;
  #fetch: typeof fetch;
  #now: () => number;

  constructor(input: { binding: OpenAISynthesisBinding; apiKey: string; transport?: typeof fetch; now?: () => number }) {
    validateBinding(input.binding);
    if (typeof input.apiKey !== "string" || !input.apiKey || /\s/.test(input.apiKey)) fail("binding-invalid");
    this.#binding = structuredClone(input.binding);
    this.#apiKey = input.apiKey;
    this.#fetch = input.transport ?? fetch;
    this.#now = input.now ?? Date.now;
    this.version = `1.0.0:${SYNTHESIS_PROMPT_VERSION}:${this.#binding.model}`;
  }

  async synthesize(input: ResearchSynthesisInput): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const binding = this.#binding;
      const now = this.#now();
      if (!Number.isFinite(now) || Date.parse(binding.expiresAt) <= now) fail("binding-expired");
      if (input.clientId !== binding.clientId || input.context?.clientId !== binding.clientId
        || !binding.abilityIds.includes(input.abilityId) || !input.market || !binding.markets.includes(input.market)
        || !input.language || !binding.languages.includes(input.language)
        || input.context.market !== input.market || input.context.language !== input.language
        || input.evidence.some((item) => !binding.allowedSourceClasses.includes(item.sourceClass))) fail("scope-denied");
      if (!input.context.solution.enabledAbilities.some((item) => item.id === input.abilityId && item.version === getDecisionBriefAbility(input.abilityId)?.version)
        || !input.context.solution.markets.includes(input.market) || !input.context.solution.languages.includes(input.language)
        || !input.question.trim() || input.question.length > 12_000 || !input.evidence.length || input.evidence.length > 200
        || new Set(input.evidence.map((item) => item.id)).size !== input.evidence.length
        || !input.context.marketTwin.length || input.context.marketTwin.some((record) => !record.evidenceIds.length
          || record.evidenceIds.some((id) => !input.evidence.some((item) => item.id === id)))) fail("input-invalid");
      const prompt = researchSynthesisPrompt(input);
      assertPeopleBlind(prompt.data);
      const data = JSON.stringify(prompt.data);
      // Fail closed rather than silently changing selected evidence or truncating methodology.
      if (redactIdentifiers(data).identityRisk) fail("input-invalid");
      const body = JSON.stringify({
        model: binding.model, instructions: prompt.instructions,
        input: [{ role: "user", content: data }],
        store: false, background: false, max_output_tokens: binding.maxOutputTokens,
        text: { format: { type: "json_schema", name: "research_analysis", strict: true, schema: RESEARCH_SYNTHESIS_SCHEMA } },
      });
      if (Buffer.byteLength(body, "utf8") > binding.maxInputBytes) fail("input-too-large");
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new SynthesisAdapterError("timeout")); }, binding.timeoutMs);
      });
      const execute = async () => {
        const response = await this.#fetch(ENDPOINT, {
          method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" }, body,
        });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); fail("timeout"); }
        if (!response.ok) { void response.body?.cancel().catch(() => {}); fail("provider-failed"); }
        const result = analysisFromResponse(await readBoundedResponse(response, binding.maxResponseBytes, controller.signal));
        const completedAt = this.#now();
        if (!Number.isFinite(completedAt) || Date.parse(binding.expiresAt) <= completedAt) fail("binding-expired");
        return result;
      };
      return await Promise.race([execute(), deadline]);
    } catch (error) {
      controller.abort();
      if (error instanceof SynthesisAdapterError) throw error;
      fail("provider-failed");
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
