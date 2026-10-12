/**
 * Rill access control (ADR 0001 — decisions/0001-rill-allowlist.md).
 *
 * Rill hosts many views that carry commercial revenue / New Depositing
 * Customer (NDC) data, which this product must never query, store, or
 * surface under any configuration. Access is controlled by an explicit,
 * enumerated measure-and-dimension allowlist — never `ALL_MEASURES`, never a
 * denylist wearing an allowlist's name. See product-spec.md section 11
 * ("Rill (internal BI) — access contract") for the full reasoning.
 *
 * PROVISIONAL CONTENTS: no Rill administrator has been named yet
 * (product-spec.md section 16, open item) and this agent has no live
 * credential or schema access to either view. The measure/dimension names
 * below are reasonable placeholders inferred from each view's own name/
 * description in product-spec.md section 11, not a certified copy of Rill's
 * actual live schema. A named data-governance approver (see CODEOWNERS at
 * the repository root) MUST re-certify this map against Rill's real, current
 * schema for both views before any live query is ever issued, and update
 * this comment once that has happened.
 */

export type RillView = "organic_search_performance" | "playbook_event_stream";

export type RillAllowlistEntry = {
  /** Explicit measure names allowed for this view. Never a wildcard. */
  measures: readonly string[];
  /** Explicit dimension names allowed for this view. Never a wildcard. */
  dimensions: readonly string[];
};

export const ALLOWED_RILL_MEASURES: Readonly<Record<RillView, RillAllowlistEntry>> = {
  organic_search_performance: {
    // Provisional — organic search ranking/traffic measures, per spec section 11.
    measures: ["avg_rank", "clicks", "impressions", "ctr"],
    // Provisional — the dimensions a search-performance row is naturally grouped by.
    dimensions: ["keyword", "date", "brand"],
  },
  playbook_event_stream: {
    // Provisional — a non-financial funnel event count, per spec section 11.
    measures: ["event_count"],
    // Provisional — the dimensions an event-stream row is naturally grouped by.
    dimensions: ["funnel_stage", "channel", "date"],
  },
};

/** The two views this product is allowed to query. Nothing else. */
export const ALLOWED_RILL_VIEWS: readonly RillView[] = Object.keys(
  ALLOWED_RILL_MEASURES,
) as RillView[];

/**
 * First layer: is `field` an explicitly named measure or dimension of
 * `view`? Any view absent from `ALLOWED_RILL_MEASURES`, or any field not
 * explicitly named for its view, is not allowed — including a field added to
 * an already-allowed view by a future, unreviewed schema change.
 */
export function isAllowed(view: string, field: string): boolean {
  const entry = (ALLOWED_RILL_MEASURES as Record<string, RillAllowlistEntry | undefined>)[view];
  if (!entry) return false;
  return entry.measures.includes(field) || entry.dimensions.includes(field);
}

/**
 * Second, independent layer: a word-boundary-matched pattern filter against
 * financial/regulated terms, run against whatever the allowlist above
 * already permits — defense in depth against a careless future addition to
 * `ALLOWED_RILL_MEASURES` itself (ADR 0001). Case-insensitive.
 *
 * Word-boundary-matched, not a raw substring match: a raw substring check
 * for `ggr` would wrongly flag an innocent field such as `aggregated_sessions`
 * (tech review, advisory finding — product-spec.md section 11). This does
 * NOT use plain regex `\b`: JavaScript's `\b` treats `_` as a word
 * character, so `\brevenue\b` would fail to flag a realistic snake_case
 * Rill field name like `total_revenue` (no boundary between `_` and `r`) —
 * a real gap in the product's single most safety-critical control. Instead,
 * a field name/digit boundary is defined explicitly with lookarounds, so
 * `_` (and any other non-alphanumeric separator) counts as a boundary too.
 */
export const BLOCKED_FIELD_PATTERNS = [
  "revenue",
  "ndc",
  "commission",
  "wagering",
  "deposit",
  "cost",
  "spend",
  "ggr",
  "ngr",
] as const;

const BLOCKED_FIELD_REGEX = new RegExp(
  `(?<![a-z0-9])(?:${BLOCKED_FIELD_PATTERNS.join("|")})(?![a-z0-9])`,
  "i",
);

/** True if `field` contains one of the blocked financial/regulated terms as a whole word. */
export function matchesBlockedPattern(field: string): boolean {
  return BLOCKED_FIELD_REGEX.test(field);
}
