import { and, desc, eq, max, sql } from "drizzle-orm";
import type { SensingProfile, SolutionProfile } from "@/src/core/contracts";
import { validateSensingProfile, validateSolutionProfile } from "@/src/core/validation";
import { db } from "@/src/db/client";
import { sensingProfile, solutionProfile } from "@/src/db/schema";

export type SolutionProfileRow = { databaseId: number; profile: SolutionProfile; createdBy: number | null };

export async function getActiveSolutionProfile(clientId: number): Promise<SolutionProfile | null> {
  const [row] = await db.select().from(solutionProfile).where(and(eq(solutionProfile.clientId, clientId), eq(solutionProfile.status, "active"))).orderBy(desc(solutionProfile.version)).limit(1);
  return row ? { ...row.profileJson as SolutionProfile, id: String(row.id), clientId: String(row.clientId), version: row.version, status: "active" } : null;
}

export async function listSolutionProfiles(clientId: number): Promise<SolutionProfileRow[]> {
  const rows = await db.select().from(solutionProfile).where(eq(solutionProfile.clientId, clientId)).orderBy(desc(solutionProfile.version));
  return rows.map((row) => ({ databaseId: row.id, profile: { ...row.profileJson as SolutionProfile, status: row.status as SolutionProfile["status"] }, createdBy: row.createdBy }));
}

export async function getSolutionProfile(clientId: number, id: number): Promise<SolutionProfileRow | null> {
  const [row] = await db.select().from(solutionProfile).where(and(eq(solutionProfile.clientId, clientId), eq(solutionProfile.id, id))).limit(1);
  return row ? { databaseId: row.id, profile: row.profileJson as SolutionProfile, createdBy: row.createdBy } : null;
}

export async function createActiveSolutionProfile(input: {
  clientId: number;
  createdBy: number;
  expectedActiveId?: number;
  profile: Omit<SolutionProfile, "id" | "clientId" | "version" | "status" | "createdAt">;
}): Promise<SolutionProfileRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73001, ${input.clientId})`);
    if (input.expectedActiveId !== undefined) {
      const [active] = await tx.select({ id: solutionProfile.id }).from(solutionProfile).where(and(eq(solutionProfile.clientId, input.clientId), eq(solutionProfile.status, "active"))).limit(1);
      if (active?.id !== input.expectedActiveId) throw new Error("active-solution-changed");
    }
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

/** Atomically imports a portable sensing profile and its bound solution profile. */
export async function createActiveSolutionBundle(input: {
  clientId: number;
  createdBy: number;
  profile: Omit<SolutionProfile, "id" | "clientId" | "version" | "status" | "createdAt" | "sensingProfileId">;
  sensing?: Omit<SensingProfile, "id" | "clientId" | "version">;
}): Promise<SolutionProfileRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73001, ${input.clientId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(73002, ${input.clientId})`);
    let sensingProfileId: string | undefined;
    if (input.sensing) {
      const [sensingVersionRow] = await tx.select({ value: max(sensingProfile.version) }).from(sensingProfile).where(eq(sensingProfile.clientId, input.clientId));
      const sensingVersion = Number(sensingVersionRow?.value ?? 0) + 1;
      const sensingDomain: SensingProfile = { ...input.sensing, id: "pending", clientId: String(input.clientId), version: sensingVersion };
      const sensingValidation = validateSensingProfile(sensingDomain);
      if (!sensingValidation.valid) throw new Error(`invalid-sensing-profile:${sensingValidation.errors.join(";")}`);
      await tx.update(sensingProfile).set({ status: "superseded" }).where(and(eq(sensingProfile.clientId, input.clientId), eq(sensingProfile.status, "active")));
      const [createdSensing] = await tx.insert(sensingProfile).values({ clientId: input.clientId, version: sensingVersion, profileJson: sensingDomain, status: "active" }).returning();
      sensingProfileId = String(createdSensing.id);
      await tx.update(sensingProfile).set({ profileJson: { ...sensingDomain, id: sensingProfileId } }).where(eq(sensingProfile.id, createdSensing.id));
    }

    const [versionRow] = await tx.select({ value: max(solutionProfile.version) }).from(solutionProfile).where(eq(solutionProfile.clientId, input.clientId));
    const version = Number(versionRow?.value ?? 0) + 1;
    const now = new Date();
    const domain: SolutionProfile = {
      ...input.profile,
      ...(sensingProfileId ? { sensingProfileId } : {}),
      id: "pending",
      clientId: String(input.clientId),
      version,
      status: "active",
      createdAt: now.toISOString(),
    };
    const validation = validateSolutionProfile(domain);
    if (!validation.valid) throw new Error(`invalid-solution-profile:${validation.errors.join(";")}`);
    await tx.update(solutionProfile).set({ status: "superseded" }).where(and(eq(solutionProfile.clientId, input.clientId), eq(solutionProfile.status, "active")));
    const [created] = await tx.insert(solutionProfile).values({ clientId: input.clientId, version, status: "active", profileJson: domain, createdBy: input.createdBy, createdAt: now }).returning();
    const stored = { ...domain, id: String(created.id) };
    await tx.update(solutionProfile).set({ profileJson: stored }).where(eq(solutionProfile.id, created.id));
    return { databaseId: created.id, profile: stored, createdBy: created.createdBy };
  });
}

