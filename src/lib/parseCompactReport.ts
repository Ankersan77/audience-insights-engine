/**
 * Parses `last30days`' `--emit=compact` stdout (T19) into evidence items
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
 *
 * Deliberately dependency-free (no `@/src/db/*` imports): `node --test`
 * cannot resolve this repo's `@/` path alias, and this logic is pure and
 * worth unit-testing on its own — see `src/db/queries/evidence.test.ts`.
 */

export type ParsedEvidenceItem = {
  source: string;
  externalId: string;
  url: string | null;
  textSnippet: string | null;
  publishedAt: Date | null;
  engagementJson: Record<string, number> | null;
  authorHandle: string | null;
};

/**
 * Sources whose stats-line "venue" field names an identifiable creator
 * (TikTok/Instagram/YouTube: `@handle` or channel name) rather than a
 * community, repo, or forum (Reddit's `r/subreddit`, Hacker News, GitHub,
 * Polymarket). Only these populate `evidence.author_handle` from that field.
 *
 * Reddit's own post *submitter* is never present in this report format at
 * all (only top-comment authors are, in the `u/<handle>` lines this parser
 * already ignores per the module doc above) — this is a known, separate gap
 * from this one, tracked in docs/dsr-procedure.md, not fixed by this list.
 */
const CREATOR_HANDLE_SOURCES = new Set(["tiktok", "instagram", "youtube"]);

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
  venue: string | null;
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
      authorHandle:
        CREATOR_HANDLE_SOURCES.has(current.source) && current.venue ? current.venue : null,
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
        venue: null,
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
          continue;
        }
        // The remaining, unparsed field in the pipe-delimited stats line is
        // the "venue": a subreddit/repo/forum for community sources, or a
        // creator/channel handle for creator-driven ones. Captured
        // unconditionally here; `flush()` decides whether it's a person's
        // handle based on `CREATOR_HANDLE_SOURCES`.
        if (part && !current.venue) {
          current.venue = part;
        }
      }
    }
    // Any other line (a comment, "- Insight:", a blank line) is ignored —
    // the next item boundary is the next numbered header, or EOF.
  }
  flush();

  return items;
}
