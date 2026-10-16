import { AppShell } from "@/src/components/AppShell";
import { PageHeader } from "@/src/components/PageHeader";
import { CORE_ABILITIES } from "@/src/abilities/catalog";
import { requireSession } from "@/src/lib/auth";
import { getWorkspaceReadiness } from "@/src/db/queries/workspace";
import { listSourceConnections } from "@/src/db/queries/sources";
import { SourceConnections } from "./SourceConnections";
import { listCanonicalEvidence } from "@/src/db/queries/canonical_evidence";
import { EvidenceOnboarding } from "./EvidenceOnboarding";
import { listDecisionBriefs, listIntelligenceRecords } from "@/src/db/queries/workspace_intelligence";
import { MarketTwin } from "./MarketTwin";
import { DecisionBriefs } from "./DecisionBriefs";

export const dynamic = "force-dynamic";

const REPOSITORY_CAPABILITIES = [
  ["Client isolation", "Direct client scope, membership, fail-closed access contracts"],
  ["Evidence pipeline", "Ephemeral acquisition, redaction, rights, methods, lifecycle and citations"],
  ["Market Twin", "Typed intelligence, contradictions, idempotent onboarding and governed promotion"],
  ["Campaign learning", "Versioned pre-flight, live and post-campaign assessment"],
  ["Measurement", "Deterministic study classification and Brand Lift claim guardrails"],
  ["Monitoring", "Materiality, corroboration, freshness, manipulation checks and no-change receipts"],
  ["Packaging", "Redacted solution profiles, version pins, idempotency and bounded failure handling"],
] as const;

const EXTERNAL_GATES = [
  "Pilot client or approved representative dataset",
  "Permissions for each live source",
  "Approved cohort, suppression and retention settings",
  "Live connector credentials and provider acceptance tests",
  "Named market-research reviewer",
  "Named Brand Lift methodology reviewer",
  "Production deployment owner and timed restore exercise",
] as const;

export default async function WorkspacePage() {
  const session = await requireSession("/workspace");
  const [readiness, sources, evidence, intelligence, briefs] = await Promise.all([
    getWorkspaceReadiness(session.clientId),
    listSourceConnections(session.clientId),
    listCanonicalEvidence(session.clientId),
    listIntelligenceRecords(session.clientId),
    listDecisionBriefs(session.clientId),
  ]);
  const readinessItems = [
    ["Sources", readiness.sources],
    ["Evidence", readiness.evidence],
    ["Market Twin records", readiness.intelligence],
    ["Decision artifacts", readiness.artifacts],
    ["Campaigns", readiness.campaigns],
    ["Studies", readiness.studies],
    ["Sensing profiles", readiness.sensingProfiles],
  ] as const;

  return (
    <AppShell user={session}>
      <PageHeader
        title="Research workspace"
        description="The governed control surface for this client's evidence, intelligence, abilities, campaigns, studies, and learning."
      />

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Client intelligence</h2>
            <p className="mt-1 text-sm text-muted">
              Persisted canonical records for {session.clientSlug}; fixture tests are not included in these totals.
            </p>
          </div>
          <span className="rounded-full bg-[var(--status-info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-info-text)]">
            Tenant scoped
          </span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {readinessItems.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Core readiness</h2>
              <p className="mt-1 text-sm text-muted">Repository-verifiable controls for {session.clientSlug}.</p>
            </div>
            <span className="rounded-full bg-[var(--status-success-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-success-text)]">
              Implemented
            </span>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {REPOSITORY_CAPABILITIES.map(([name, detail]) => (
              <li key={name} className="rounded-md border border-border p-3">
                <p className="font-medium text-foreground">{name}</p>
                <p className="mt-1 text-sm text-muted">{detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">External validation</h2>
              <p className="mt-1 text-sm text-muted">Required before live-source or production claims.</p>
            </div>
            <span className="rounded-full bg-[var(--status-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-warning-text)]">
              Needs context
            </span>
          </div>
          <ul className="mt-4 flex flex-col gap-2">
            {EXTERNAL_GATES.map((gate) => (
              <li key={gate} className="flex items-start gap-2 rounded-md border border-border p-3 text-sm text-foreground">
                <span aria-hidden="true" className="mt-0.5 text-[var(--status-warning-text)]">○</span>
                <span>{gate}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Market Research does not convert missing approval, unavailable data, or an unreviewed method into a silent pass.
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-foreground">Core research abilities</h2>
        <p className="mt-1 text-sm text-muted">All abilities share the same evidence-resolution and decision-brief contracts.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {CORE_ABILITIES.map((ability) => (
            <article key={ability.id} className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-foreground">{ability.id.replaceAll("-", " ")}</h3>
                <span className="font-mono text-xs text-muted">v{ability.version}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{ability.intent}</p>
              <p className="mt-3 text-xs text-muted">Human gates: {ability.humanGates.join(", ")}</p>
            </article>
          ))}
        </div>
      </section>

      <SourceConnections initialSources={sources} isAdmin={session.role === "admin"} />
      <EvidenceOnboarding initialEvidence={evidence} sources={sources} isAdmin={session.role === "admin"} />
      <MarketTwin initialRecords={intelligence} evidence={evidence} isAdmin={session.role === "admin"} />
      <DecisionBriefs abilities={CORE_ABILITIES} evidence={evidence} initialBriefs={briefs} isAdmin={session.role === "admin"} />
    </AppShell>
  );
}
