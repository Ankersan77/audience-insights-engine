# Data-subject-rights (DSR) procedure

Covers a GDPR Art. 17 (erasure) or Art. 21 (objection) request from an
identifiable social-media poster whose handle appears in this system's
`evidence` table, via `evidence.author_handle`.

This document is mechanical steps only. It does not decide whether a request
is valid, whether an exemption applies, or who is legally allowed to act on
it — any of that is for whoever at the company owns data-subject requests
(not yet named; see "Open item" at the end). This procedure starts once that
decision has already been made and someone needs to actually do the deletion.

## 1. Find every row for the handle

Every `evidence` row carries the source, a stable per-source `external_id`,
and (where populated — see the note below) the poster's handle. Find all
rows for a given handle with:

```sql
SELECT id, run_id, source, external_id, url, author_handle, published_at, retrieved_at
FROM evidence
WHERE author_handle = '<handle>';
```

If the request names a profile URL rather than a bare handle instead, also
search `url`:

```sql
SELECT id, run_id, source, external_id, url, author_handle, published_at, retrieved_at
FROM evidence
WHERE author_handle = '<handle>' OR url ILIKE '%<handle>%';
```

Also check whether any of those rows were used as the evidentiary basis for
an `insight` (via `insight_evidence`), since that is what step 3 below is
about:

```sql
SELECT i.id, i.title, i.status, i.delivery_status, i.reviewed_at, i.routed_at
FROM insight i
JOIN insight_evidence ie ON ie.insight_id = i.id
JOIN evidence e ON e.id = ie.evidence_id
WHERE e.author_handle = '<handle>';
```

**Current honest caveat:** `evidence.author_handle` exists in the schema, but
the report parser that populates `evidence` rows today
(`src/db/queries/evidence.ts`, `storeEvidenceForRun`) does not currently
extract or set it — every row's `author_handle` is `NULL` as of this writing.
Until that parsing gap is closed, a handle search above will not find rows by
`author_handle` alone; fall back to the `url ILIKE` search, and to a manual
`text_snippet` search (`WHERE text_snippet ILIKE '%<handle>%'`) as a second
pass, since the parser does capture post text/URLs even though it does not
yet extract the handle into its own column. Whoever closes that gap should
also update this note.

## 2. Delete the rows

Once the rows to remove are confirmed (step 1's query, reviewed by whoever
owns the request), delete them directly:

```sql
DELETE FROM evidence WHERE author_handle = '<handle>';
-- or, if using the URL/text fallback above:
DELETE FROM evidence WHERE id IN (<the specific ids confirmed in step 1>);
```

This is a direct SQL delete against the production database, run by someone
with database access (there is no admin-UI button for this in v1). Deleting
an `evidence` row cascades to delete any `insight_evidence` link row pointing
at it (`ON DELETE CASCADE`, `src/db/schema.ts`); the `insight` row itself is
**not** deleted (its foreign key to `evidence` is via the join table only,
and `insight.run_id`'s own foreign key to `research_run` is `ON DELETE
RESTRICT`, unrelated to this deletion) — the Insight's title/summary text may
still reference the deleted content in prose even after its supporting
Evidence row is gone. If the Insight's own text should also be removed or
redacted, that is a separate, manual judgement call (see step 3), not
something this delete does automatically.

This job's existing retention/purge mechanism
(`src/workers/purgeEvidence.ts`, T27) performs the same kind of delete on a
time-based ceiling once Legal sets one; a DSR-triggered delete is the same
operation, run ad hoc, immediately, for one named handle rather than an age
cutoff.

## 3. The residual-risk disclosure (read this before telling anyone the request is "done")

**An Insight that has already been accepted and delivered — to Slack or to
Drive — cannot be retracted by this procedure, or by any mechanism this
product has in v1.**

Concretely: if evidence from the requesting handle contributed to an Insight
that a reviewer already accepted (`insight.status = 'accepted'`) and that was
successfully delivered (`insight.delivery_status = 'delivered'`), deleting
the `evidence` row in step 2 does not and cannot:

- Delete or edit the Slack message that was already posted.
- Delete or edit the Drive file that was already written (once Drive write
  delivery exists — see product-spec.md's Out-of-scope note; it is inert
  today).
- Remove the Insight's own `title`/`summary` text from the `insight` table,
  which may still describe content originally sourced from that handle even
  with its underlying `evidence` row gone.

This is a structural limitation, not an oversight to fix as part of this
procedure: once a message is sent to a third-party system this product does
not own (a Slack workspace, a Drive folder), this product has no delete API
call it can make against that system's own copy. The only way to fully
honour an erasure request that reaches an already-delivered Insight is a
manual step outside this system entirely — someone with access to the Slack
channel or Drive folder manually removing or editing the message/file.

**Legal must accept this residual risk before launch (spec §10/§16).** This
document does not resolve that; it only makes clear, for whoever next acts on
a real request, exactly what deleting the database rows does and does not
reach.

## Open item

No person or role has yet been named as the owner of incoming data-subject
requests for this product (spec §16, open item). Until one is named, treat
any such request as a stop-and-escalate: do not delete anything under this
procedure without that named owner's (or Legal's) sign-off that the request
is valid and the residual-risk disclosure above has been accepted.
