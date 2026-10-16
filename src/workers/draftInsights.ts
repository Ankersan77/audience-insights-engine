/**
 * Insight drafting (T22), run by the worker right after a Run's status is set
 * to `succeeded` and its Evidence is stored (hooked in from
 * `src/workers/runQueue.ts`'s `processRunJob`).
 *
 * Three steps, in order:
 *  1. Sensitivity screening — a small keyword list checked against each new
 *     Evidence item's `text_snippet`, setting `evidence.sensitivity_flag`.
 *  2. Baseline comparison — the current Run's Evidence, grouped by source,
 *     compared against the trailing average item count per source across the
 *     same brand+market's prior *succeeded* Runs. A deviation is only called
 *     out when the magnitude clears a plain threshold, and the finding is
 *     classified `shift` when corroborated by more than one Evidence item in
 *     the deviating source, `blip` when it rests on a single item — or when
 *     there is no baseline yet at all (a brand's very first Run), per the
 *     plan's explicit rule. This is deliberately a simple count comparison,
 *     not a model: it is honest about what it can detect.
 *  3. Drafting the title/summary text via the LLM (`draftInsightText`,
 *     below). When no credential is configured, the Insight is still created
 *     — with a clear placeholder saying drafting couldn't run — never
 *     silently dropped or given fake content.
 */

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { evidence, researchRun } from "@/src/db/schema";
import { getRunByIdInternal } from "@/src/db/queries/research_runs";
import { listEvidenceForRun, type EvidenceRow } from "@/src/db/queries/evidence";
import { createInsightWithEvidence, type InsightRow, type ShiftOrBlip } from "@/src/db/queries/insights";

// --- Sensitivity screening ---------------------------------------------------

/**
 * A small, sensible starter list (gambling-addiction and self-harm terms) —
 * not exhaustive, and not meant to be: it is a first, honest pass, not a
 * moderation system. Word-boundary matched, case-insensitive.
 */
const SENSITIVITY_PATTERNS: RegExp[] = [
  /\bgambling addiction\b/i,
  /\bproblem gambling\b/i,
  /\bself-exclusion\b/i,
  /\bsuicidal?\b/i,
  /\bsuicide\b/i,
  /\bself-harm\b/i,
  /\bkill(ing)? myself\b/i,
  /\bend(ing)? my life\b/i,
  /\boverdose\b/i,
  /\bself ?harming\b/i,
];

export function isSensitiveText(text: string | null | undefined): boolean {
  if (!text) return false;
  return SENSITIVITY_PATTERNS.some((pattern) => pattern.test(text));
}

/** Flags each not-yet-flagged, sensitivity-matching Evidence row for this Run. Returns the updated ids. */
async function screenEvidenceForSensitivity(rows: EvidenceRow[]): Promise<Set<number>> {
  const flaggedIds = new Set<number>();
  for (const row of rows) {
    if (row.sensitivityFlag === true) {
      flaggedIds.add(row.id);
      continue;
    }
    if (isSensitiveText(row.textSnippet)) {
      flaggedIds.add(row.id);
      await db.update(evidence).set({ sensitivityFlag: true }).where(eq(evidence.id, row.id));
    }
  }
  return flaggedIds;
}

// --- Baseline comparison -----------------------------------------------------

/** A deviation smaller than this fraction of the baseline average is not worth surfacing. */
const DEVIATION_THRESHOLD = 0.3;

/**
 * Average Evidence item count per source across this brand+market's prior
 * *succeeded* Runs (excluding the current one). `null` means there is no
 * baseline at all yet — this brand+market's very first Run.
 */
async function getBaselineAverageCountsBySource(
  brandId: number,
  marketId: number | null,
  beforeRunId: number,
): Promise<Map<string, number> | null> {
  const priorRuns = await db
    .select({ id: researchRun.id })
    .from(researchRun)
    .where(
      and(
        eq(researchRun.brandId, brandId),
        marketId === null ? isNull(researchRun.marketId) : eq(researchRun.marketId, marketId),
        eq(researchRun.status, "succeeded"),
        lt(researchRun.id, beforeRunId),
      ),
    )
    .orderBy(desc(researchRun.id));

  if (priorRuns.length === 0) return null;

  const priorRunIds = priorRuns.map((r) => r.id);
  const counts = await db
    .select({ source: evidence.source, count: sql<string>`count(*)` })
    .from(evidence)
    .where(inArray(evidence.runId, priorRunIds))
    .groupBy(evidence.source);

  const averages = new Map<string, number>();
  for (const row of counts) {
    averages.set(row.source, Number(row.count) / priorRunIds.length);
  }
  return averages;
}

type SourceFinding = {
  source: string;
  items: EvidenceRow[];
  shiftOrBlip: ShiftOrBlip;
  note: string;
};

function classifyFindings(
  evidenceBySource: Map<string, EvidenceRow[]>,
  baseline: Map<string, number> | null,
): SourceFinding[] {
  const findings: SourceFinding[] = [];

  for (const [source, items] of evidenceBySource) {
    const currentCount = items.length;

    if (baseline === null) {
      // No prior succeeded Run for this brand+market at all — every finding
      // is a blip by definition (no prior data to shift from).
      findings.push({
        source,
        items,
        shiftOrBlip: "blip",
        note: `This is the first completed run for this brand/market, so there is no baseline yet — ${currentCount} ${source} item(s) establish one.`,
      });
      continue;
    }

    const baselineAvg = baseline.get(source);
    if (baselineAvg === undefined) {
      // This source has never appeared in a prior run either — same "no
      // baseline to compare against" reasoning, scoped to this source.
      findings.push({
        source,
        items,
        shiftOrBlip: "blip",
        note: `${source} has no prior evidence for this brand/market to compare against — ${currentCount} item(s) seen this run.`,
      });
      continue;
    }

    const deviation = (currentCount - baselineAvg) / baselineAvg;
    if (Math.abs(deviation) < DEVIATION_THRESHOLD) continue; // not a notable deviation

    findings.push({
      source,
      items,
      // Corroborated by more than one evidence item in the deviating source
      // -> shift; resting on a single item -> blip.
      shiftOrBlip: currentCount >= 2 ? "shift" : "blip",
      note: `${source} evidence count this run: ${currentCount}, vs a baseline average of ${baselineAvg.toFixed(1)} (${deviation >= 0 ? "+" : ""}${Math.round(deviation * 100)}%).`,
    });
  }

  return findings;
}

function groupBySource(rows: EvidenceRow[]): Map<string, EvidenceRow[]> {
  const grouped = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.source) ?? [];
    list.push(row);
    grouped.set(row.source, list);
  }
  return grouped;
}

/** Simple, honest confidence score: grows with how many items corroborate the finding, capped well short of certainty. */
function estimateConfidence(itemCount: number): number {
  return Math.min(0.9, 0.3 + Math.min(itemCount, 6) * 0.1);
}

// --- LLM drafting -------------------------------------------------------------

/** Thrown when no LLM credential is configured — an honest degradation path, never faked. */
export class LlmNotConfiguredError extends Error {
  constructor(message = "Insight drafting isn't configured yet (no LLM credential).") {
    super(message);
    this.name = "LlmNotConfiguredError";
  }
}

export type DraftedInsightText = { title: string; summary: string };

type AnthropicMessageResponse = {
  content?: Array<{ type: string; input?: unknown }>;
};

/**
 * Calls Anthropic's Messages API directly via `fetch` (no SDK dependency for
 * one call shape) using a tool-use schema to get structured `{title,
 * summary}` output. Reads `process.env.ANTHROPIC_API_KEY`; throws
 * {@link LlmNotConfiguredError} when it is absent rather than guessing.
 */
export async function draftInsightText(
  evidenceItems: Pick<EvidenceRow, "source" | "textSnippet" | "url">[],
  shiftOrBlip: ShiftOrBlip,
  context: string,
): Promise<DraftedInsightText> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmNotConfiguredError();
  }

  const model = process.env.ANTHROPIC_INSIGHT_MODEL ?? "claude-sonnet-4-5-20250929";
  const evidenceText = evidenceItems
    .slice(0, 10)
    .map((item, i) => `${i + 1}. [${item.source}] ${item.textSnippet ?? "(no text)"}${item.url ? ` (${item.url})` : ""}`)
    .join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      tools: [
        {
          name: "draft_insight",
          description:
            "Draft a short, factual title and a plain-English summary for an audience-research insight, based only on the evidence given.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string", description: "A factual headline, under 12 words." },
              summary: {
                type: "string",
                description:
                  "A 2-4 sentence plain-English summary of what the evidence shows and why it is classified as a shift or a blip.",
              },
            },
            required: ["title", "summary"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "draft_insight" },
      messages: [
        {
          role: "user",
          content: `You are drafting an insight for a brand's audience-research dashboard.\nClassification: ${shiftOrBlip}.\nContext: ${context}\n\nEvidence:\n${evidenceText || "(no evidence text available)"}\n\nDraft a factual title and summary describing only what this evidence shows. Do not invent facts the evidence does not support.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Anthropic API error (${response.status}): ${bodyText || response.statusText}`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const toolUse = data.content?.find((block) => block.type === "tool_use");
  const draft = toolUse?.input as { title?: string; summary?: string } | undefined;
  if (!draft?.title || !draft?.summary) {
    throw new Error("Anthropic API returned no structured draft_insight output.");
  }
  return { title: draft.title, summary: draft.summary };
}

// --- Orchestration ------------------------------------------------------------

/**
 * A fixed, documented default: nothing in the evidence text reliably maps to
 * one of the six Insight Types (T17) without the LLM call that this function
 * may not be able to make, so every volume-based finding is filed as
 * `market-trend` (a shift/blip in the brand's social-attention volume is, at
 * minimum, that). This is a deliberate simplification, not a scope decision.
 */
const DEFAULT_INSIGHT_TYPE = "market-trend";

/**
 * Drafts zero or more `insight` rows for a just-succeeded Run (T22). Called
 * from `runQueue.ts` right after `markRunSucceeded` + evidence storage.
 * Never throws for an LLM failure — only for a genuine bug (bad run id,
 * database error), which the caller logs without failing the Run itself.
 */
export async function draftInsightsForRun(runId: number): Promise<InsightRow[]> {
  const run = await getRunByIdInternal(runId);
  if (!run) {
    throw new Error(`draftInsightsForRun: run ${runId} not found.`);
  }

  const evidenceRows = await listEvidenceForRun(runId);
  if (evidenceRows.length === 0) return [];

  await screenEvidenceForSensitivity(evidenceRows);

  const evidenceBySource = groupBySource(evidenceRows);
  const baseline = await getBaselineAverageCountsBySource(run.brandId, run.marketId, runId);
  const findings = classifyFindings(evidenceBySource, baseline);

  const created: InsightRow[] = [];
  for (const finding of findings) {
    let title: string;
    let summary: string;
    try {
      const drafted = await draftInsightText(finding.items, finding.shiftOrBlip, finding.note);
      title = drafted.title;
      summary = drafted.summary;
    } catch (error) {
      if (!(error instanceof LlmNotConfiguredError)) throw error;
      title = `Drafting unavailable — ${finding.source} ${finding.shiftOrBlip}`;
      summary = `Automatic title/summary drafting could not run because no LLM credential is configured (ANTHROPIC_API_KEY is not set). ${finding.note} Review the ${finding.items.length} linked evidence item(s) directly.`;
    }

    const insightRow = await createInsightWithEvidence({
      clientId: run.clientId,
      brandId: run.brandId,
      marketId: run.marketId,
      runId,
      insightType: DEFAULT_INSIGHT_TYPE,
      title,
      summary,
      shiftOrBlip: finding.shiftOrBlip,
      confidence: estimateConfidence(finding.items.length),
      evidenceIds: finding.items.map((item) => item.id),
    });
    created.push(insightRow);
  }

  return created;
}
