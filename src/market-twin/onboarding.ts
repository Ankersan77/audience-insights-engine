import { createHash } from "node:crypto";
import type { Applicability, IntelligenceKind, IntelligenceRecord, MethodDeclaration } from "../core/contracts.ts";

export type StructuredSourceStatement = {
  kind: Extract<IntelligenceKind, "fact" | "hypothesis" | "knowledge_gap">;
  title: string;
  statement: string;
  evidenceIds: readonly string[];
  confidence: number;
  applicability: Applicability;
  method: MethodDeclaration;
  contradictionKeys?: readonly string[];
};

export type OnboardingSource = {
  clientId: string;
  sourceId: string;
  sourceVersion: string;
  title: string;
  statements: readonly StructuredSourceStatement[];
};

export type OnboardingResult = {
  candidates: readonly IntelligenceRecord[];
  methodByCandidateId: Readonly<Record<string, MethodDeclaration>>;
};

function stableId(source: OnboardingSource, statement: StructuredSourceStatement): string {
  return createHash("sha256")
    .update(`${source.clientId}\u0000${source.sourceId}\u0000${source.sourceVersion}\u0000${statement.kind}\u0000${statement.statement}`)
    .digest("hex")
    .slice(0, 24);
}

export function extractOnboardingCandidates(source: OnboardingSource, now: string): OnboardingResult {
  const methods: Record<string, MethodDeclaration> = {};
  const candidates = source.statements.map((statement) => {
    const id = stableId(source, statement);
    methods[id] = statement.method;
    return {
      id,
      clientId: source.clientId,
      kind: statement.kind,
      title: statement.title,
      statement: statement.statement,
      lifecycle: "candidate" as const,
      reviewState: "pending" as const,
      evidenceIds: statement.evidenceIds,
      contradictionIds: statement.contradictionKeys ?? [],
      dependencyIds: [],
      applicability: statement.applicability,
      confidence: statement.confidence,
      uncertainty: statement.method.limitations,
      synthesisBy: "human" as const,
      createdAt: now,
    };
  });
  return { candidates, methodByCandidateId: methods };
}

export class MarketTwinStore {
  #records = new Map<string, IntelligenceRecord>();

  importCandidates(records: readonly IntelligenceRecord[]): { inserted: number; unchanged: number } {
    let inserted = 0;
    let unchanged = 0;
    for (const record of records) {
      const existing = this.#records.get(record.id);
      if (existing) {
        unchanged += 1;
      } else {
        this.#records.set(record.id, structuredClone(record));
        inserted += 1;
      }
    }
    return { inserted, unchanged };
  }

  review(id: string, decision: "accepted" | "rejected" | "revision_requested", reviewerClientId: string, now: string): IntelligenceRecord {
    const record = this.#records.get(id);
    if (!record || record.clientId !== reviewerClientId) throw new Error("market-twin-record-not-found");
    const updated: IntelligenceRecord = {
      ...record,
      reviewState: decision,
      lifecycle: decision === "accepted" ? "live" : decision === "rejected" ? "superseded" : "candidate",
      reviewedAt: now,
    };
    this.#records.set(id, updated);
    return structuredClone(updated);
  }

  list(clientId: string): IntelligenceRecord[] {
    return [...this.#records.values()]
      .filter((record) => record.clientId === clientId)
      .map((record) => structuredClone(record));
  }
}
