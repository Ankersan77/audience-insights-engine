import { asc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { evidence } from "@/src/db/schema";

/**
 * Parses `last30days`' `--emit=compact` stdout (T19) into `evidence` rows
 * (T21). The compact format repeats the same block shape per ranked item
 * regardless of source — Reddit, Hacker News, GitHub, YouTube all look like:
 *
 *   ### N. <title> (score NN, K item, sources: <Source>)
 *   1. [source] <title>
 *      - <date> | <venue> | [<engagement tokens>] | score:NN
 *      - URL: [<url>](<url>)
 *      - Evidence: <snippet>
 *      - u/<handle> (<n> upvotes): <comment>   (zero or more, ignored here)
 *      - Insight: <text>                        (ignored here)
 *
 * Reddit is the only source this project has live-verified end to end
 * (keyless; T19's smoke test), so its `external_id` gets a source-specific,
 * stable extraction (the post id out of the permalink). Every other
 * source — including the X/TikTok lanes that never fire without a
 * credential — falls through to the same generic handling and simply
 * produces zero items when absent from the report; nothing here assumes a
 * source is present.
 */

export type ParsedEvidenceItem = {
  source: string;
  externalId: string;
  url: string | null;
  textSnippet: string | null;
  publishedAt: Date | null;
  engagementJson: Record<string, number> | null;
};

const ITEM_HEADER_RE = /^\d+\.\s*\[(\w+)\]\s*(.+?)\s*$/;
const URL_LINE_RE = /^-\s*URL:\s*\[(.*?)\]\((.*?)\)\s*$/;
const EVIDENCE_LINE_RE = /^-\s*Evidence:\s*(.*)$/;
const STATS_LINE_RE = /^-\s*(?!URL:|Evidence:|Insight:)(.+)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BRACKET_RE = /^\[(.*)\]$/;
const ENGAGEMENT_TOKEN_RE = /([\d][\d,]*)\s*([A-Za-z]+)/g;

type InProgressItem = {
  source: string;
  title: string;
  url: string | null;
  textSnippet: string | null;
  publishedAt: Date | null;
  engagementJson: Record<string, number> | null;
  statsLineSeen: boolean;
};

function parseEngagement(bracketContent: string): Record<string, number> | null {
  const result: Record<string, number> = {};
  for (const match of bracketContent.matchAll(ENGAGEMENT_TOKEN_RE)) {
    const value = Number(match[1].replace(/,/g, ""));
    const label = match[2].toLowerCase();
    if (!Number.isNaN(value)) {
      result[label] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Stable, deterministic id — never a random one, so a re-parse of the same
 * report is idempotent against `evidence`'s `(run_id, source, external_id)`
 * uniqueness constraint (T4). */
function resolveExternalId(source: string, url: string | null, title: string): string {
  if (url) {
    if (source === "reddit") {
      const m = url.match(/\/comments\/([a-zA-Z0-9]+)/);
      if (m) return m[1];
    }
    if (source === "youtube") {
      const m = url.match(/[?&]v=([\w-]+)/);
      if (m) return m[1];
    }
    if (source === "hackernews") {
      const m = url.match(/item\?id=(\d+)/);
      if (m) return m[1];
    }
    if (source === "github") {
      const m = url.match(/\/(pull|issues)\/(\d+)/);
      if (m) return `${m[1]}-${m[2]}`;
    }
    return url;
  }
  return `${source}:${title}`;
}

export function parseCompactReport(stdout: string): ParsedEvidenceItem[] {
  const lines = stdout.split(/\r?\n/);
  const items: ParsedEvidenceItem[] = [];
  let current: InProgressItem | null = null;

  const flush = () => {
    if (!current) return;
    const externalId = resolveExternalId(current.source, current.url, current.title);
    const textSnippet = current.textSnippet
      ? `${current.title} — ${current.textSnippet}`
      : current.title || null;
    items.push({
      source: current.source,
      externalId,
      url: current.url,
      textSnippet,
      publishedAt: current.publishedAt,
      engagementJson: current.engagementJson,
    });
    current = null;
  };

  for (const rawLine of lines) {
    // Compact report indents every bullet under its numbered item (e.g.
    // "   - URL: ..."), so leading whitespace has to go too, not just trailing.
    const line = rawLine.trim();
    const headerMatch = line.match(ITEM_HEADER_RE);
    if (headerMatch) {
      flush();
      current = {
        source: headerMatch[1].toLowerCase(),
        title: headerMatch[2].trim(),
        url: null,
        textSnippet: null,
        publishedAt: null,
        engagementJson: null,
        statsLineSeen: false,
      };
      continue;
    }
    if (!current) continue;

    const urlMatch = line.match(URL_LINE_RE);
    if (urlMatch) {
      current.url = urlMatch[2] || urlMatch[1] || null;
      continue;
    }

    const evidenceMatch = line.match(EVIDENCE_LINE_RE);
    if (evidenceMatch) {
      current.textSnippet = evidenceMatch[1].trim() || null;
      continue;
    }

    if (!current.statsLineSeen && STATS_LINE_RE.test(line)) {
      current.statsLineSeen = true;
      const body = line.replace(/^-\s*/, "");
      for (const part of body.split(" | ").map((p) => p.trim())) {
        if (DATE_RE.test(part)) {
          const parsed = new Date(part);
          if (!Number.isNaN(parsed.getTime())) current.publishedAt = parsed;
          continue;
        }
        const bracket = part.match(BRACKET_RE);
        if (bracket) {
          current.engagementJson = parseEngagement(bracket[1]);
        }
      }
    }
    // Any other line (a comment, "- Insight:", a blank line) is ignored —
    // the next item boundary is the next numbered header, or EOF.
  }
  flush();

  return items;
}

export type EvidenceRow = {
  id: number;
  runId: number;
  source: string;
  externalId: string;
  url: string | null;
  authorHandle: string | null;
  publishedAt: Date | null;
  textSnippet: string | null;
  engagementJson: unknown;
  retrievedAt: Date;
  sensitivityFlag: boolean | null;
};

/** Idempotent: a re-parse of the same report inserts nothing new, relying on
 * the `(run_id, source, external_id)` uniqueness constraint (T4). */
export async function storeEvidenceForRun(runId: number, stdout: string): Promise<number> {
  const items = parseCompactReport(stdout);
  if (items.length === 0) return 0;

  const inserted = await db
    .insert(evidence)
    .values(
      items.map((item) => ({
        runId,
        source: item.source,
        externalId: item.externalId,
        url: item.url,
        publishedAt: item.publishedAt,
        textSnippet: item.textSnippet,
        engagementJson: item.engagementJson,
      })),
    )
    .onConflictDoNothing({ target: [evidence.runId, evidence.source, evidence.externalId] })
    .returning({ id: evidence.id });

  return inserted.length;
}

export async function listEvidenceForRun(runId: number): Promise<EvidenceRow[]> {
  const rows = await db
    .select()
    .from(evidence)
    .where(eq(evidence.runId, runId))
    .orderBy(asc(evidence.source), asc(evidence.id));
  return rows;
}
