import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/src/db/client";
import { client, governanceAudit, synthesisAuthorization, synthesisBudget } from "@/src/db/schema";
import { validateSynthesisAttempt, validateSynthesisBudget, type SynthesisBudgetPolicy, type SynthesisAttempt, type SynthesisPermit, type SynthesisOutcome, type SynthesisSpendLedger } from "@/src/abilities/synthesisBudget";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Trusted dispatch-time authority; lock its rows and return a time/config recheck. */
export type SynthesisAuthorityGuard = (tx: Tx) => Promise<(now: Date) => void>;
const terminal = new Set(["succeeded", "failed", "cancelled", "unknown"]);
function id(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("synthesis-permit-invalid");
  return Number(value);
}
async function clock(tx: Tx): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(result.rows[0].now);
}
async function lock(tx: Tx, clientId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(73008, ${clientId})`);
}
function window(now: Date) {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
async function audit(tx: Tx, clientId: number, authorizationId: number, action: string, metadata: Record<string, unknown>) {
  const [row] = await tx.insert(governanceAudit).values({ clientId, action, entityType: "synthesis_authorization", entityId: String(authorizationId), redactedAfterJson: metadata }).returning({ id: governanceAudit.id });
  return row.id;
}

/** Trusted operator path only. No default grants and no resetting spent reservations. */
export async function setSynthesisBudget(clientSlug: string, policy: SynthesisBudgetPolicy): Promise<void> {
  validateSynthesisBudget(policy);
  policy = { currency: policy.currency, dailyCostMicros: policy.dailyCostMicros, dailyRequests: policy.dailyRequests, enabled: policy.enabled };
  await db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: client.id }).from(client).where(eq(client.slug, clientSlug));
    if (!tenant) throw new Error("synthesis-budget-client-not-found");
    await lock(tx, tenant.id);
    const [before] = await tx.select().from(synthesisBudget).where(eq(synthesisBudget.clientId, tenant.id));
    const [prior] = await tx.select({ currency: synthesisAuthorization.currency }).from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, tenant.id)).limit(1);
    if (prior && prior.currency !== policy.currency) throw new Error("synthesis-budget-currency-change-requires-migration");
    const [after] = await tx.insert(synthesisBudget).values({ clientId: tenant.id, ...policy }).onConflictDoUpdate({
      target: synthesisBudget.clientId,
      set: { ...policy, version: sql`${synthesisBudget.version} + 1`, updatedAt: await clock(tx) },
    }).returning();
    await tx.insert(governanceAudit).values({ clientId: tenant.id, action: "operator_set_synthesis_budget", entityType: "synthesis_budget", entityId: String(tenant.id), redactedBeforeJson: before ?? null, redactedAfterJson: after });
  });
}

export async function reserveSynthesisAttempt(input: SynthesisAttempt, guard?: SynthesisAuthorityGuard): Promise<SynthesisPermit> {
  // Projection prevents raw prompts, keys and arbitrary fields reaching the ledger.
  input = { clientId: input.clientId, attemptKey: input.attemptKey, abilityId: input.abilityId, inputDigest: input.inputDigest, plan: { ...input.plan } };
  validateSynthesisAttempt(input);
  const clientId = id(input.clientId);
  const plan = input.plan;
  return db.transaction(async (tx) => {
    await lock(tx, clientId);
    const [budget] = await tx.select().from(synthesisBudget).where(eq(synthesisBudget.clientId, clientId));
    if (!budget?.enabled) throw new Error("synthesis-budget-not-enabled");
    validateSynthesisBudget(budget);
    if (budget.currency !== plan.currency) throw new Error("synthesis-budget-currency-mismatch");
    const recheck = await guard?.(tx);
    const now = await clock(tx); // After lock acquisition, including UTC midnight contention.
    recheck?.(now);
    const bindingExpiresAt = new Date(plan.bindingExpiresAt);
    if (bindingExpiresAt <= now) throw new Error("synthesis-binding-expired");
    const { start, end } = window(now);
    const [used] = await tx.select({ cost: sql<string>`coalesce(sum(${synthesisAuthorization.maxCostMicros}), 0)::text`,
      requests: sql<string>`count(*)::text` }).from(synthesisAuthorization).where(and(eq(synthesisAuthorization.clientId, clientId),
      gte(synthesisAuthorization.authorizedAt, start), lt(synthesisAuthorization.authorizedAt, end)));
    if (BigInt(used.cost) + BigInt(plan.maxCostMicros) > BigInt(budget.dailyCostMicros)
      || BigInt(used.requests) + BigInt(1) > BigInt(budget.dailyRequests)) throw new Error("synthesis-budget-daily-limit");
    const [row] = await tx.insert(synthesisAuthorization).values({ clientId, attemptKey: input.attemptKey,
      abilityId: input.abilityId, inputDigest: input.inputDigest, providerId: plan.providerId, providerVersion: plan.providerVersion,
      model: plan.model, approvalReference: plan.approvalReference, currency: plan.currency, maxCostMicros: plan.maxCostMicros,
      maxInputBytes: plan.maxInputBytes, maxOutputTokens: plan.maxOutputTokens, maxDurationMs: plan.maxDurationMs,
      budgetVersion: budget.version, bindingExpiresAt, authorizedAt: now,
      dispatchBy: new Date(Math.min(now.getTime() + 60_000, end.getTime(), bindingExpiresAt.getTime())),
    }).onConflictDoNothing().returning();
    if (!row) throw new Error("synthesis-attempt-already-reserved");
    await audit(tx, clientId, row.id, "reserve_synthesis", { attemptKey: row.attemptKey, inputDigest: row.inputDigest,
      abilityId: row.abilityId, providerId: row.providerId, providerVersion: row.providerVersion, model: row.model,
      approvalReference: row.approvalReference, currency: row.currency, maxCostMicros: row.maxCostMicros, budgetVersion: row.budgetVersion });
    const completedAt = await clock(tx);
    recheck?.(completedAt);
    if (row.dispatchBy <= completedAt) throw new Error("synthesis-permit-expired");
    return { clientId: String(clientId), id: String(row.id) };
  });
}

/** Single-use dispatch claim, before credential access. A lost response cannot be replayed. */
export async function dispatchSynthesisAttempt(permit: SynthesisPermit, guard?: SynthesisAuthorityGuard): Promise<{ expiresAt: string }> {
  const clientId = id(permit.clientId); const authorizationId = id(permit.id);
  return db.transaction(async (tx) => {
    await lock(tx, clientId);
    const [budget] = await tx.select().from(synthesisBudget).where(eq(synthesisBudget.clientId, clientId));
    const [row] = await tx.select().from(synthesisAuthorization).where(and(eq(synthesisAuthorization.clientId, clientId), eq(synthesisAuthorization.id, authorizationId))).for("update");
    if (!row || row.status !== "reserved") throw new Error("synthesis-permit-not-dispatchable");
    if (!budget?.enabled || budget.version !== row.budgetVersion) throw new Error("synthesis-budget-changed");
    const recheck = await guard?.(tx);
    const now = await clock(tx);
    recheck?.(now);
    if (row.dispatchBy <= now || row.bindingExpiresAt <= now) throw new Error("synthesis-permit-expired");
    const executionDeadline = new Date(Math.min(now.getTime() + row.maxDurationMs, row.bindingExpiresAt.getTime()));
    await tx.update(synthesisAuthorization).set({ status: "dispatched", dispatchedAt: now,
      executionDeadline,
    }).where(eq(synthesisAuthorization.id, row.id));
    await audit(tx, clientId, row.id, "dispatch_synthesis", { status: "dispatched", budgetVersion: row.budgetVersion });
    const completedAt = await clock(tx);
    recheck?.(completedAt);
    if (row.dispatchBy <= completedAt || executionDeadline <= completedAt) throw new Error("synthesis-permit-expired");
    return { expiresAt: executionDeadline.toISOString() };
  });
}

export async function finishSynthesisAttempt(permit: SynthesisPermit, outcome: SynthesisOutcome, guard?: SynthesisAuthorityGuard): Promise<{ accepted: boolean }> {
  if (!terminal.has(outcome)) throw new Error("synthesis-outcome-invalid");
  const clientId = id(permit.clientId); const authorizationId = id(permit.id);
  return db.transaction(async (tx) => {
    await lock(tx, clientId);
    const [budget] = await tx.select().from(synthesisBudget).where(eq(synthesisBudget.clientId, clientId));
    const [row] = await tx.select().from(synthesisAuthorization).where(and(eq(synthesisAuthorization.clientId, clientId), eq(synthesisAuthorization.id, authorizationId))).for("update");
    if (!row) throw new Error("synthesis-permit-not-found");
    if (terminal.has(row.status)) return { accepted: false }; // Metadata retry is harmless, never a new result authorization.
    if (row.status !== "dispatched" && outcome === "succeeded") throw new Error("synthesis-not-dispatched");
    let recheck: ((now: Date) => void) | undefined;
    let authorityValid = true;
    if (outcome === "succeeded") {
      try { recheck = await guard?.(tx); } catch { authorityValid = false; }
    }
    const now = await clock(tx);
    try { recheck?.(now); } catch { authorityValid = false; }
    let accepted = authorityValid && outcome === "succeeded" && row.status === "dispatched" && Boolean(budget?.enabled)
      && budget!.version === row.budgetVersion && row.bindingExpiresAt > now && Boolean(row.executionDeadline && row.executionDeadline > now);
    const status = outcome === "succeeded" && !accepted ? "unknown" : outcome;
    await tx.update(synthesisAuthorization).set({ status, finishedAt: now }).where(eq(synthesisAuthorization.id, row.id));
    const auditId = await audit(tx, clientId, row.id, "finish_synthesis", { status, resultAuthorized: accepted });
    // Audit/table contention may outlive the grant even while row locks are held.
    const completedAt = await clock(tx);
    try { recheck?.(completedAt); } catch { authorityValid = false; }
    if (accepted && (!authorityValid || row.bindingExpiresAt <= completedAt || row.executionDeadline! <= completedAt)) {
      accepted = false;
      await tx.update(synthesisAuthorization).set({ status: "unknown", finishedAt: completedAt }).where(eq(synthesisAuthorization.id, row.id));
      await tx.update(governanceAudit).set({ redactedAfterJson: { status: "unknown", resultAuthorized: false } }).where(eq(governanceAudit.id, auditId));
    }
    return { accepted };
  });
}

function expiredAttempts(now: Date | SQL) {
  return sql`((${synthesisAuthorization.status} = 'reserved' and ${synthesisAuthorization.dispatchBy} <= ${now}) or (${synthesisAuthorization.status} = 'dispatched' and ${synthesisAuthorization.executionDeadline} <= ${now}))`;
}
const attemptDeadline = sql`case when ${synthesisAuthorization.status} = 'reserved' then ${synthesisAuthorization.dispatchBy} else ${synthesisAuthorization.executionDeadline} end`;

/** Caller holds the same tenant lock as admission, dispatch and completion. */
async function reconcileClient(tx: Tx, clientId: number, limit: number): Promise<number> {
  const now = await clock(tx);
  const expired = await tx.select().from(synthesisAuthorization).where(and(eq(synthesisAuthorization.clientId, clientId), expiredAttempts(now)))
    .orderBy(attemptDeadline, synthesisAuthorization.id).limit(limit).for("update");
  for (const row of expired) {
    const status = row.status === "reserved" ? "cancelled" : "unknown";
    await tx.update(synthesisAuthorization).set({ status, finishedAt: now }).where(eq(synthesisAuthorization.id, row.id));
    await audit(tx, clientId, row.id, "reconcile_synthesis", { status, resultAuthorized: false });
  }
  return expired.length;
}

/** Reconcile crashes without retrying calls or refunding reservations. Bounded per invocation. */
export async function reconcileSynthesisAttempts(clientSlug: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: client.id }).from(client).where(eq(client.slug, clientSlug));
    if (!tenant) throw new Error("synthesis-budget-client-not-found");
    await lock(tx, tenant.id);
    return reconcileClient(tx, tenant.id, 1000);
  });
}

/** Independent worker maintenance: bounded, oldest-first and safe to repeat across processes.
 * Busy tenants are deferred, not allowed to hold up other tenants. Each tenant commits separately;
 * an audit/write failure rolls back that tenant and is reported without exposing database errors.
 */
export async function reconcileDueSynthesisAttempts() {
  const tenants = await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    return tx.select({ clientId: synthesisAuthorization.clientId }).from(synthesisAuthorization)
      .where(expiredAttempts(sql`statement_timestamp()`)).groupBy(synthesisAuthorization.clientId)
      .orderBy(sql`min(${attemptDeadline})`, synthesisAuthorization.clientId).limit(20);
  });
  const result = { examinedClients: tenants.length, reconciledAttempts: 0, busyClients: 0, failedClients: 0, batchFull: tenants.length === 20 };
  for (const tenant of tenants) {
    try {
      const count = await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '1s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        const acquired = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(73008, ${tenant.clientId}) as locked`);
        if (!acquired.rows[0].locked) return null;
        return reconcileClient(tx, tenant.clientId, 50);
      });
      if (count === null) result.busyClients++;
      else { result.reconciledAttempts += count; if (count === 50) result.batchFull = true; }
    } catch { result.failedClients++; }
  }
  return result;
}

export async function inspectSynthesisBudget(clientSlug: string) {
  const [tenant] = await db.select({ id: client.id }).from(client).where(eq(client.slug, clientSlug));
  if (!tenant) throw new Error("synthesis-budget-client-not-found");
  const [policy] = await db.select().from(synthesisBudget).where(eq(synthesisBudget.clientId, tenant.id));
  const [usage] = await db.select({
    authorizedCostMicros: sql<string>`coalesce(sum(${synthesisAuthorization.maxCostMicros}), 0)::text`,
    authorizedRequests: sql<string>`count(*)::text`,
    unknownAttempts: sql<string>`count(*) filter (where ${synthesisAuthorization.status} = 'unknown')::text`,
    expiredUnresolvedAttempts: sql<string>`count(*) filter (where (${synthesisAuthorization.status} = 'reserved' and ${synthesisAuthorization.dispatchBy} <= current_timestamp) or (${synthesisAuthorization.status} = 'dispatched' and ${synthesisAuthorization.executionDeadline} <= current_timestamp))::text`,
  }).from(synthesisAuthorization).where(and(eq(synthesisAuthorization.clientId, tenant.id),
    sql`${synthesisAuthorization.authorizedAt} >= (date_trunc('day', current_timestamp at time zone 'UTC') at time zone 'UTC')`,
    sql`${synthesisAuthorization.authorizedAt} < (date_trunc('day', current_timestamp at time zone 'UTC') at time zone 'UTC') + interval '1 day'`));
  // Recovery is not a daily cost window: yesterday's crashed work must remain visible.
  const [backlog] = await db.select({
    expiredUnresolvedAttempts: sql<string>`count(*) filter (where ${expiredAttempts(sql`statement_timestamp()`)})::text`,
    unknownAttempts: sql<string>`count(*) filter (where ${synthesisAuthorization.status} = 'unknown')::text`,
    oldestExpiredAt: sql<string | null>`min(${attemptDeadline}) filter (where ${expiredAttempts(sql`statement_timestamp()`)})::text`,
  }).from(synthesisAuthorization).where(eq(synthesisAuthorization.clientId, tenant.id));
  return { policy: policy ?? null, usage, backlog, backlogWindow: "All authorization days", window: "UTC authorization day", accounting: "Reserved upper bounds, not measured provider charges. No automatic refunds or replay." };
}

export const synthesisSpendLedger: SynthesisSpendLedger = {
  reserve: reserveSynthesisAttempt, dispatch: dispatchSynthesisAttempt, finish: finishSynthesisAttempt,
};
