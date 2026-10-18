# People-blind evidence and data-subject procedure

The target product does not need identifiable consumer records. It retains trends, themes,
statistics, source-level provenance, and the minimum public excerpts needed to support a claim.
It must not create consumer profiles or cross-platform identity graphs.

Migration `0020_r1b_legacy_schema_cleanup` removes the former `evidence.author_handle` field and all
legacy identity-bearing storage. The active product has no handle lookup, consumer profile or
person-level activation surface.

For a verified erasure or objection request, authenticate the requester through the approved case
process, identify the installation/client and named source connection, and record the decision and
legal-hold status outside application logs. Do not search for a person by expanding the product's
data model. Review current canonical evidence only through authorized source/evidence references;
revoke the source when rights no longer permit use and allow bounded canonical maintenance to
redact or expire dependent artifacts. Verify the fail-closed projection while cleanup is pending.

Any request concerning a database or backup held at migration `0019` or earlier is contrary estate
evidence. Stop ordinary handling, isolate the copy, and reopen the R1B disposition and recovery
gate. The historical SQL procedure is available only from annotated tag `pre-r1b-v2.1.0`; never
attach current application code to that restored pre-R1B database or paste identity-bearing query
results into tickets, chat or logs.

## Release gate

Production ingestion must continue to prove that:

- retained evidence has no consumer identity field;
- public excerpts are minimized and redacted before persistence;
- source, rights, retrieval time, geography, language, and citation level remain available;
- raw acquisition data is isolated from retained evidence and expires under policy;
- tests reject identity-bearing and cross-platform-linkage fields at the ingestion boundary.
