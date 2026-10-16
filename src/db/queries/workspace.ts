import { count, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  campaign,
  canonicalEvidence,
  intelligenceRecord,
  researchArtifact,
  sensingProfile,
  sourceConnection,
  study,
} from "@/src/db/schema";

export type WorkspaceReadiness = {
  sources: number;
  evidence: number;
  intelligence: number;
  artifacts: number;
  campaigns: number;
  studies: number;
  sensingProfiles: number;
};

async function tenantCount(
  table:
    | typeof sourceConnection
    | typeof canonicalEvidence
    | typeof intelligenceRecord
    | typeof researchArtifact
    | typeof campaign
    | typeof study
    | typeof sensingProfile,
  clientId: number,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(table)
    .where(eq(table.clientId, clientId));
  return Number(row?.value ?? 0);
}

/**
 * Owned-surface projection for canonical records. Every count carries the
 * authenticated client key directly; no global aggregate is exposed.
 */
export async function getWorkspaceReadiness(clientId: number): Promise<WorkspaceReadiness> {
  if (!Number.isInteger(clientId) || clientId <= 0) throw new Error("invalid-client-scope");
  const [sources, evidence, intelligence, artifacts, campaigns, studies, sensingProfiles] = await Promise.all([
    tenantCount(sourceConnection, clientId),
    tenantCount(canonicalEvidence, clientId),
    tenantCount(intelligenceRecord, clientId),
    tenantCount(researchArtifact, clientId),
    tenantCount(campaign, clientId),
    tenantCount(study, clientId),
    tenantCount(sensingProfile, clientId),
  ]);
  return { sources, evidence, intelligence, artifacts, campaigns, studies, sensingProfiles };
}

