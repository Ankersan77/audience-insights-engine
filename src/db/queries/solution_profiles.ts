import { and, desc, eq, max, sql } from "drizzle-orm";
import type { SolutionProfile } from "@/src/core/contracts";
import { validateSolutionProfile } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { solutionProfile } from "@/src/db/schema";

export type SolutionProfileRow = { databaseId: number; profile: SolutionProfile; createdBy: number | null };

export async function listSolutionProfiles(clientId: number): Promise<SolutionProfileRow[]> {
  const rows = await db.select().from(solutionProfile).where(eq(solutionProfile.clientId, clientId)).orderBy(desc(solutionProfile.version));
  return rows.map((row) => ({ databaseId: row.id, profile: row.profileJson as SolutionProfile, createdBy: row.createdBy }));
}

export async function getSolutionProfile(clientId: number, id: number): Promise<SolutionProfileRow | null> {
  const [row] = await db.select().from(solutionProfile).where(and(eq(solutionProfile.clientId, clientId), eq(solutionProfile.id, id))).limit(1);
  return row ? { databaseId: row.id, profile: row.profileJson as SolutionProfile, createdBy: row.createdBy } : null;
}

export async function createActiveSolutionProfile(input: {
  clientId: number;
  createdBy: number;
  profile: Omit<SolutionProfile, "id" | "clientId" | "version" | "status" | "createdAt">;
}): Promise<SolutionProfileRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73001, ${input.clientId})`);
    const [versionRow] = await tx.select({ value: max(solutionProfile.version) }).from(solutionProfile).where(eq(solutionProfile.clientId, input.clientId));
    const version = Number(versionRow?.value ?? 0) + 1;
    const now = new Date();
    const domain: SolutionProfile = { ...input.profile, id: "pending", clientId: String(input.clientId), version, status: "active", createdAt: now.toISOString() };
    const validation = validateSolutionProfile(domain);
    if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
    await tx.update(solutionProfile).set({ status: "superseded" }).where(and(eq(solutionProfile.clientId, input.clientId), eq(solutionProfile.status, "active")));
    const [created] = await tx.insert(solutionProfile).values({ clientId: input.clientId, version, status: "active", profileJson: domain, createdBy: input.createdBy, createdAt: now }).returning();
    const stored = { ...domain, id: String(created.id) };
    await tx.update(solutionProfile).set({ profileJson: stored }).where(eq(solutionProfile.id, created.id));
    return { databaseId: created.id, profile: stored, createdBy: created.createdBy };
  });
}

