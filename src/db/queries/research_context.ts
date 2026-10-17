import type { ResearchContextSources } from "@/src/abilities/context";
import { getResearchProject } from "./projects";
import { getActiveSolutionProfile } from "./solution_profiles";
import { listSensingProfiles } from "./monitoring";
import { listIntelligenceRecords } from "./workspace_intelligence";
import { listSourceConnections } from "./sources";
import { loadEvidenceItems } from "./canonical_evidence";
import { getCompanyContext } from "./company_context";

export async function loadResearchContextSources(input: { clientId: number; projectId?: number; evidenceIds?: readonly number[] }): Promise<ResearchContextSources> {
  const [project, solution, sensing, intelligence, connections, company] = await Promise.all([
    input.projectId ? getResearchProject(input.clientId, input.projectId) : null,
    getActiveSolutionProfile(input.clientId), listSensingProfiles(input.clientId), listIntelligenceRecords(input.clientId), listSourceConnections(input.clientId),
    getCompanyContext(input.clientId),
  ]);
  const evidenceIds = input.evidenceIds?.length
    ? [...new Set([...input.evidenceIds, ...intelligence.filter((item) => item.reviewState === "accepted" && item.lifecycle === "live").flatMap((item) => item.evidenceIds.map(Number))])]
    : undefined;
  const now = Date.now();
  const allowedConnections = connections.filter((item) => item.health !== "unavailable" && item.rights.commercialUse
    && (!item.rights.expiresAt || Date.parse(item.rights.expiresAt) > now) && item.policy.permittedPurposes.includes("market-research"));
  return { project, solution, company, sensing: sensing.find((item) => item.profile.id === solution?.sensingProfileId)?.profile,
    intelligence, evidence: await loadEvidenceItems(input.clientId, evidenceIds),
    sourceBindings: Object.fromEntries(allowedConnections.map((item) => [item.connectorId, String(item.id)])),
  };
}
