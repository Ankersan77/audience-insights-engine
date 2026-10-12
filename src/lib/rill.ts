import { db } from "@/src/db/client";
import { auditLog } from "@/src/db/schema";
import {
  ALLOWED_RILL_MEASURES,
  isAllowed,
  matchesBlockedPattern,
  type RillView,
} from "@/src/lib/rillAllowlist";

/**
 * Rill query wrapper (ADR 0001 — decisions/0001-rill-allowlist.md). Every
 * call goes through three layers, in order, before any network request is
 * ever attempted:
 *
 *   (a) the view itself must be one of `ALLOWED_RILL_MEASURES`'s keys;
 *   (b) every requested field must be explicitly named for that view;
 *   (c) whatever survives (a)+(b) is run through the word-boundary pattern
 *       filter as defense in depth, and any match is stripped, not passed
 *       through;
 *   (d) only then is the live HTTP call attempted — and since no
 *       `RILL_API_TOKEN` is provisioned anywhere in this environment
 *       (product-spec.md section 16, open item), that call always throws
 *       `RillNotConfiguredError` today. Same honest-degradation pattern as
 *       Slack (src/lib/slack.ts) and Drive (src/lib/drive.ts).
 *
 * Every call — allowed, rejected, or not-configured — writes one `audit_log`
 * row, per the spec's single most safety-critical control.
 */

/** Thrown when `RILL_API_TOKEN` is absent. */
export class RillNotConfiguredError extends Error {
  constructor(message = "Rill isn't connected yet.") {
    super(message);
    this.name = "RillNotConfiguredError";
  }
}

/** Thrown when the requested view or a requested field is not allowlisted. */
export class RillAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RillAccessDeniedError";
  }
}

/**
 * Optional attribution for the audit_log row this call writes. `runId` is
 * the `research_run` this query belongs to (T20/T21); omit it for a call
 * made outside a Run (e.g. a manual/ad-hoc query), in which case `0` is
 * recorded as the entity id (audit_log.entity_id has no foreign key — it is
 * interpreted per entity_type, and `0` means "no associated run").
 */
export type RillQueryContext = {
  userId?: number;
  runId?: number;
};

async function audit(
  action: string,
  view: string,
  requestedFields: string[],
  context: RillQueryContext | undefined,
  extra: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLog).values({
    userId: context?.userId ?? null,
    action,
    entityType: "rill_view",
    entityId: context?.runId ?? 0,
    beforeJson: { view, requestedFields, ...extra },
    afterJson: null,
  });
}

export type RillRow = Record<string, unknown>;

/**
 * Queries an allowlisted Rill view for allowlisted fields only. Rejects
 * before any network call if the view or any field is not explicitly
 * allowlisted; strips (does not silently pass through) any surviving field
 * name that matches the financial/regulated pattern filter.
 */
export async function queryRill(
  view: string,
  fields: string[],
  context?: RillQueryContext,
): Promise<RillRow[]> {
  // (a) the view itself must be allowlisted.
  if (!(view in ALLOWED_RILL_MEASURES)) {
    await audit("rill-query-rejected", view, fields, context, {
      reason: "view-not-allowed",
    });
    throw new RillAccessDeniedError(`Rill view "${view}" is not in ALLOWED_RILL_MEASURES.`);
  }

  // (b) every requested field must be explicitly named for that view.
  const disallowedFields = fields.filter((field) => !isAllowed(view, field));
  if (disallowedFields.length > 0) {
    await audit("rill-query-rejected", view, fields, context, {
      reason: "field-not-allowed",
      disallowedFields,
    });
    throw new RillAccessDeniedError(
      `Rill field(s) not allowed for "${view}": ${disallowedFields.join(", ")}`,
    );
  }

  // (c) defense in depth: strip anything matching the blocked-pattern filter,
  // even though it already passed the explicit allowlist above.
  const strippedFields = fields.filter((field) => matchesBlockedPattern(field));
  const safeFields = fields.filter((field) => !matchesBlockedPattern(field));
  if (strippedFields.length > 0) {
    await audit("rill-query-field-stripped", view, fields, context, {
      strippedFields,
    });
  }

  // (d) only now would the actual HTTP call to Rill's API happen.
  const token = process.env.RILL_API_TOKEN;
  if (!token) {
    await audit("rill-query-attempted", view, safeFields, context, {
      outcome: "not-configured",
    });
    throw new RillNotConfiguredError();
  }

  await audit("rill-query-attempted", view, safeFields, context, {
    outcome: "live-call",
  });

  // Not live-verifiable in this environment: no RILL_API_TOKEN has ever been
  // provisioned here (T24, deferred — no Rill administrator named yet). The
  // request shape below is this module's best-documented guess at Rill's
  // query API and MUST be confirmed against Rill's real API contract once a
  // credential and administrator exist, before this path is ever exercised
  // live.
  const baseUrl = process.env.RILL_API_BASE_URL ?? "https://admin.rilldata.com";
  const response = await fetch(`${baseUrl}/v1/query/${encodeURIComponent(view)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ view, fields: safeFields }),
  });

  if (!response.ok) {
    throw new Error(`Rill API error (${response.status}): ${response.statusText}`);
  }

  const data = (await response.json()) as { rows?: RillRow[] };
  const rows = data.rows ?? [];

  // Final defense: even on the way back out, a returned row only ever keeps
  // the fields this call actually resolved to query for (safeFields) — never
  // the raw upstream payload.
  return rows.map((row) => {
    const filtered: RillRow = {};
    for (const field of safeFields) {
      if (field in row) filtered[field] = row[field];
    }
    return filtered;
  });
}

export type { RillView };
