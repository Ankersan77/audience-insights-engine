# People-blind evidence and preserved legacy-data procedure

The target product does not need identifiable consumer records. It retains trends, themes,
statistics, source-level provenance, and the minimum public excerpts needed to support a claim.
It must not create consumer profiles or cross-platform identity graphs.

The preserved legacy schema still contains `evidence.author_handle`. Its application routes and
workers were removed in R1A2. This is migration debt, not a
target-product requirement. Until Phase 2 replaces the evidence model, use the procedure below for
any verified erasure or objection request involving legacy data.

## Locate affected legacy evidence

```sql
SELECT id, run_id, source, external_id, url, author_handle, published_at, retrieved_at
FROM evidence
WHERE author_handle = '<verified_handle>'
   OR url ILIKE '%<verified_handle>%'
   OR text_snippet ILIKE '%<verified_handle>%';
```

Before changing data, record who approved the request and the exact evidence IDs in the case
record. Free-text matching can produce false positives and must be reviewed manually.

## Remove confirmed records

```sql
DELETE FROM evidence
WHERE id IN (<reviewed_evidence_ids>);
```

Deletion cascades to `insight_evidence` links but not to the insight text itself. Review any linked
insight and redact or supersede its title and summary when they contain the affected material.
Historical audit records and backups follow the configured retention and legal-hold policy.

## Phase 2 release gate

Production ingestion must not launch on the legacy identity-bearing evidence contract. Phase 2
must prove that:

- retained evidence has no consumer identity field;
- public excerpts are minimized and redacted before persistence;
- source, rights, retrieval time, geography, language, and citation level remain available;
- raw acquisition data is isolated from retained evidence and expires under policy;
- tests reject identity-bearing and cross-platform-linkage fields at the ingestion boundary.
