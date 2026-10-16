import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { acquisitionAuthorization, acquisitionBudget, client, governanceAudit, sourceAcquisitionJob, sourceConnection } from "@/src/db/schema";
import { readSourceConnectionPolicy, sourceClassification, sourcePolicyFailure } from "@/src/connectors/sourcePolicy";
import type { SourceAcquisitionRequest } from "@/src/connectors/contracts";
import type { RightsDeclaration, SourceClass } from "@/src/core/contracts";
import { validateAcquisitionPlan, validateBudgetPolicy, validatePlanAgainstSource, type AcquisitionBudgetPolicy, type AcquisitionPlan } from "@/src/evidence/acquisitionBudget";
import { checkBudgetVersion, lockBudgetAuthority, type BudgetWriteAuthority } from "./budget_authority";

/** Trusted operator CLI or authenticated admin with locked authority and expected version.
 * Public routes must supply authority. No automatic grants or defaults authorizing paid access.
 */
export async function setAcquisitionBudget(clientSlug: string, policy: AcquisitionBudgetPolicy, authority?: BudgetWriteAuthority): Promise<void> {
  validateBudgetPolicy(policy);
  authority = authority ? { ...authority } : undefined;
  policy = { currency: policy.currency, dailyCostMicros: policy.dailyCostMicros, dailyRecords: policy.dailyRecords, dailyRequests: policy.dailyRequests, enabled: policy.enabled };
  await db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: client.id }).from(client).where(eq(client.slug, clientSlug));
    if (!tenant) throw new Error("budget-client-not-found");
    await tx.execute(sql`select pg_advisory_xact_lock(73007, ${tenant.id})`);
    const recheck = await lockBudgetAuthority(tx, tenant.id, authority);
    const clock = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    recheck(new Date(clock.rows[0].now));
    const [before] = await tx.select().from(acquisitionBudget).where(eq(acquisitionBudget.clientId, tenant.id));
    checkBudgetVersion(before?.version, authority);
    const [prior] = await tx.select({ currency: acquisitionAuthorization.currency }).from(acquisitionAuthorization).where(eq(acquisitionAuthorization.clientId, tenant.id)).limit(1);
    if (prior && prior.currency !== policy.currency) throw new Error("budget-currency-change-requires-migration");
    const [after] = await tx.insert(acquisitionBudget).values({ clientId: tenant.id, ...policy })
      .onConflictDoUpdate({ target: acquisitionBudget.clientId, set: { ...policy, version: sql`${acquisitionBudget.version} + 1`, updatedAt: new Date(clock.rows[0].now) } }).returning();
    await tx.insert(governanceAudit).values({ clientId: tenant.id, actorUserId: authority?.actorUserId, action: authority ? "admin_set_acquisition_budget" : "operator_set_acquisition_budget", entityType: "acquisition_budget", entityId: String(tenant.id), redactedBeforeJson: before ?? null, redactedAfterJson: after });
    const completed = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    recheck(new Date(completed.rows[0].now));
  });
}

/** Serialize across ALL sources for a tenant, then lock source → job (shared governance order). */
export async function authorizeAcquisitionAttempt(input: { clientId: number; jobId: number; attempt: number; plan: AcquisitionPlan }): Promise<{ attemptKey: string }> {
  input = { ...input, plan: { ...input.plan } };
  validateAcquisitionPlan(input.plan);
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 3) throw new Error("budget-invalid-attempt");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73007, ${input.clientId})`);
    const [budget] = await tx.select().from(acquisitionBudget).where(eq(acquisitionBudget.clientId, input.clientId));
    if (!budget?.enabled) throw new Error("budget-not-enabled");
    validateBudgetPolicy(budget);
    if (budget.currency !== input.plan.currency) throw new Error("budget-currency-mismatch");
    const [pending] = await tx.select().from(sourceAcquisitionJob).where(and(eq(sourceAcquisitionJob.id, input.jobId), eq(sourceAcquisitionJob.clientId, input.clientId)));
    if (!pending) throw new Error("budget-job-not-found");
    const [source] = await tx.select().from(sourceConnection).where(and(eq(sourceConnection.id, pending.sourceConnectionId), eq(sourceConnection.clientId, input.clientId))).for("update");
    const [job] = await tx.select().from(sourceAcquisitionJob).where(and(eq(sourceAcquisitionJob.id, input.jobId), eq(sourceAcquisitionJob.clientId, input.clientId))).for("update");
    if (!source || job?.status !== "running") throw new Error("acquisition-cancelled");
    // Read the database clock AFTER waiting for locks; midnight cannot reset a queued admission early.
    const clock = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    const now = new Date(clock.rows[0].now);
    const policy = readSourceConnectionPolicy(source.configurationJson);
    const failure = sourcePolicyFailure({ health: source.health, rights: source.rightsJson as RightsDeclaration, policy,
      request: job.requestJson as SourceAcquisitionRequest, dataClassification: sourceClassification(source.sourceClass as SourceClass), now: now.toISOString() });
    if (failure) throw new Error(failure);
    validatePlanAgainstSource(input.plan, policy);
    const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const [used] = await tx.select({
      cost: sql<string>`coalesce(sum(${acquisitionAuthorization.maxCostMicros}), 0)::text`,
      records: sql<string>`coalesce(sum(${acquisitionAuthorization.maxRecords}), 0)::text`,
      requests: sql<string>`coalesce(sum(${acquisitionAuthorization.maxRequests}), 0)::text`,
    }).from(acquisitionAuthorization).where(and(eq(acquisitionAuthorization.clientId, input.clientId), gte(acquisitionAuthorization.authorizedAt, start), lt(acquisitionAuthorization.authorizedAt, end)));
    if (BigInt(used.cost) + BigInt(input.plan.maxCostMicros) > BigInt(budget.dailyCostMicros)
      || BigInt(used.records) + BigInt(input.plan.maxRecords) > BigInt(budget.dailyRecords)
      || BigInt(used.requests) + BigInt(input.plan.maxRequests) > BigInt(budget.dailyRequests)) throw new Error("budget-daily-limit");
    // Never replay an authorization: a previous process may already have used it externally.
    const [authorization] = await tx.insert(acquisitionAuthorization).values({ clientId: input.clientId, jobId: input.jobId, attempt: input.attempt,
      currency: input.plan.currency, maxCostMicros: input.plan.maxCostMicros, maxRecords: input.plan.maxRecords, maxRequests: input.plan.maxRequests, authorizedAt: now })
      .onConflictDoNothing().returning({ id: acquisitionAuthorization.id });
    if (!authorization) throw new Error("budget-attempt-already-authorized");
    return { attemptKey: `acquisition-${input.clientId}-${input.jobId}-${input.attempt}-${authorization.id}` };
  });
}

export async function inspectAcquisitionBudget(clientReference: string | number) {
  const [tenant] = await db.select({ id: client.id }).from(client).where(typeof clientReference === "number" ? eq(client.id, clientReference) : eq(client.slug, clientReference));
  if (!tenant) throw new Error("budget-client-not-found");
  const [policy] = await db.select().from(acquisitionBudget).where(eq(acquisitionBudget.clientId, tenant.id));
  const [usage] = await db.select({
    authorizedCostMicros: sql<string>`coalesce(sum(${acquisitionAuthorization.maxCostMicros}), 0)::text`,
    authorizedRecords: sql<string>`coalesce(sum(${acquisitionAuthorization.maxRecords}), 0)::text`,
    authorizedRequests: sql<string>`coalesce(sum(${acquisitionAuthorization.maxRequests}), 0)::text`,
  }).from(acquisitionAuthorization).where(and(eq(acquisitionAuthorization.clientId, tenant.id),
    sql`${acquisitionAuthorization.authorizedAt} >= (date_trunc('day', current_timestamp at time zone 'UTC') at time zone 'UTC')`,
    sql`${acquisitionAuthorization.authorizedAt} < (date_trunc('day', current_timestamp at time zone 'UTC') at time zone 'UTC') + interval '1 day'`));
  return { policy: policy ?? null, usage, window: "UTC authorization day", accounting: "Conservative upper bounds; not actual provider charges; no automatic refunds." };
}
