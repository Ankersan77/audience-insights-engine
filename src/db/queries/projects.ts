import { and, desc, eq } from "drizzle-orm";
import type { ResearchProject } from "@/src/core/contracts";
import { validateResearchProject } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { researchProject } from "@/src/db/schema";

function domain(row: typeof researchProject.$inferSelect): ResearchProject {
  return {
    id: String(row.id), clientId: String(row.clientId), name: row.name, decision: row.decision,
    markets: row.markets, languages: row.languages, status: row.status as ResearchProject["status"],
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listResearchProjects(clientId: number): Promise<ResearchProject[]> {
  return (await db.select().from(researchProject).where(eq(researchProject.clientId, clientId)).orderBy(desc(researchProject.updatedAt))).map(domain);
}

export async function getResearchProject(clientId: number, id: number): Promise<ResearchProject | null> {
  const [row] = await db.select().from(researchProject).where(and(eq(researchProject.clientId, clientId), eq(researchProject.id, id))).limit(1);
  return row ? domain(row) : null;
}

export async function createResearchProject(input: { clientId: number; createdBy: number; name: string; decision: string; markets: readonly string[]; languages: readonly string[]; now: Date }): Promise<ResearchProject> {
  const candidate: ResearchProject = {
    id: "pending", clientId: String(input.clientId), name: input.name, decision: input.decision,
    markets: input.markets, languages: input.languages, status: "active", createdAt: input.now.toISOString(), updatedAt: input.now.toISOString(),
  };
  const validation = validateResearchProject(candidate);
  if (!validation.valid) throw new Error(`invalid-research-project:${validation.errors.join(";")}`);
  const [created] = await db.insert(researchProject).values({
    clientId: input.clientId, name: input.name, decision: input.decision, markets: [...input.markets], languages: [...input.languages],
    status: "active", createdBy: input.createdBy, createdAt: input.now, updatedAt: input.now,
  }).returning();
  return domain(created);
}

export async function setResearchProjectStatus(input: { clientId: number; id: number; status: ResearchProject["status"]; now: Date }): Promise<ResearchProject | null> {
  const [updated] = await db.update(researchProject).set({ status: input.status, updatedAt: input.now }).where(and(
    eq(researchProject.clientId, input.clientId), eq(researchProject.id, input.id),
  )).returning();
  return updated ? domain(updated) : null;
}
