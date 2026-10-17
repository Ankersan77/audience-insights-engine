import { and, asc, eq } from "drizzle-orm";
import { externalValidationGate, researchProject } from "@/src/db/schema";
import { prepareResearchContext } from "@/src/abilities/context";
import { runAbility } from "@/src/abilities/engine";
import { researchSnapshotDigest } from "@/src/abilities/snapshot";
import { synthesisEvidenceItem, type ResearchSynthesisInput } from "@/src/abilities/synthesis";
import { synthesisBindingDigest, type SynthesisDeploymentBinding } from "@/src/connectors/synthesisConfiguration";
import { lockedContext } from "./campaign_preflight";
import { researchProjectDomain } from "./projects";
import type { SynthesisAuthorityGuard } from "./synthesis_budget";

export function synthesisApprovalScope(binding: SynthesisDeploymentBinding) { return `research-synthesis:${synthesisBindingDigest(binding)}`; }

/** Budget lock → acceptance gates → project → company → sensing/solution → sources/evidence/intelligence.
 * No network operations are performed while these locks are held.
 */
export function synthesisAuthorityGuard(input: ResearchSynthesisInput, binding: SynthesisDeploymentBinding, assertConfiguration: () => void): SynthesisAuthorityGuard {
  input = structuredClone(input); binding = structuredClone(binding);
  return async (tx) => {
    if (input.clientId !== binding.clientId || !input.context || input.context.clientId !== binding.clientId
      || !input.market || !binding.markets.includes(input.market) || !input.language || !binding.languages.includes(input.language)
      || !binding.abilityIds.includes(input.abilityId) || !input.evidence.length
      || (input.context.company && !binding.allowedSourceClasses.includes("client_owned"))
      || input.evidence.some((item) => !binding.allowedSourceClasses.includes(item.sourceClass))) throw new Error("synthesis-authority-scope-denied");
    const clientId = Number(binding.clientId);
    const gates = await tx.select().from(externalValidationGate).where(eq(externalValidationGate.clientId, clientId)).orderBy(asc(externalValidationGate.gateKey)).for("share");
    const projectId = input.context.project?.id;
    if (projectId && (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId)))) throw new Error("synthesis-project-invalid");
    const [project] = projectId ? await tx.select().from(researchProject).where(and(eq(researchProject.clientId, clientId), eq(researchProject.id, Number(projectId)))).for("share") : [];
    const context = await lockedContext(tx, clientId, input.market, input.language);
    const ids = new Set(input.evidence.map((item) => item.id));
    if (ids.size !== input.evidence.length) throw new Error("synthesis-evidence-invalid");
    const expectedContext = researchSnapshotDigest(input.context);
    const expectedEvidence = researchSnapshotDigest([...input.evidence].sort((a, b) => a.id.localeCompare(b.id)));
    return (now) => {
      assertConfiguration();
      if (Date.parse(binding.expiresAt) <= now.getTime()) throw new Error("synthesis-binding-expired");
      for (const [key, reference] of [["live_connectors", binding.approvalReference], ["research_quality", binding.qualityApprovalReference]]) {
        const gate = gates.find((item) => item.gateKey === key);
        if (!gate || gate.status !== "verified" || !gate.verifiedBy || !gate.verifiedAt || gate.verifiedAt > now
          || !gate.expiresAt || gate.expiresAt <= now || gate.evidenceReference !== reference
          || gate.scope !== synthesisApprovalScope(binding) || !gate.owner.trim() || gate.owner === "Unassigned") throw new Error("synthesis-acceptance-required");
      }
      const current = context(now.toISOString());
      const evidence = current.evidence.filter((item) => ids.has(item.id));
      if (evidence.length !== ids.size || evidence.some((item) => !binding.sourceConnectionIds.includes(item.sourceConnectionId))) throw new Error("synthesis-source-not-approved");
      const prepared = prepareResearchContext({ clientId: input.clientId, abilityId: input.abilityId, projectId,
        market: input.market, language: input.language, now: now.toISOString(),
        sources: { ...current, project: project ? researchProjectDomain(project) : undefined, evidence } });
      if (prepared.gaps.length || !prepared.context || researchSnapshotDigest(prepared.context) !== expectedContext) throw new Error("synthesis-context-changed");
      const preliminary = runAbility({ clientId: input.clientId, abilityId: input.abilityId, question: input.question,
        now: now.toISOString(), market: input.market, language: input.language,
        evidence: prepared.evidence, contextEvidence: prepared.contextEvidence });
      if (preliminary.researchGaps.some((gap) => gap !== "No evidence-backed analysis has been supplied.")
        || preliminary.evidenceIds.length !== ids.size || preliminary.evidenceIds.some((id) => !ids.has(id))
        || researchSnapshotDigest(evidence.map(synthesisEvidenceItem).sort((a, b) => a.id.localeCompare(b.id))) !== expectedEvidence)
        throw new Error("synthesis-evidence-changed");
    };
  };
}
