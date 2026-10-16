export type TenantRole = "owner" | "admin" | "researcher" | "reviewer" | "viewer";

export type TenantContext = {
  userId: string;
  clientId: string;
  role: TenantRole;
};

export class TenantAccessError extends Error {
  constructor(message = "tenant-access-denied") {
    super(message);
    this.name = "TenantAccessError";
  }
}

const WRITE_ROLES = new Set<TenantRole>(["owner", "admin", "researcher"]);
const REVIEW_ROLES = new Set<TenantRole>(["owner", "admin", "reviewer"]);

export function assertTenantScope(context: TenantContext, recordClientId: string): void {
  if (!context.clientId || context.clientId !== recordClientId) throw new TenantAccessError();
}

export function assertTenantWrite(context: TenantContext, recordClientId = context.clientId): void {
  assertTenantScope(context, recordClientId);
  if (!WRITE_ROLES.has(context.role)) throw new TenantAccessError("tenant-write-denied");
}

export function assertTenantReview(context: TenantContext, recordClientId = context.clientId): void {
  assertTenantScope(context, recordClientId);
  if (!REVIEW_ROLES.has(context.role)) throw new TenantAccessError("tenant-review-denied");
}

export function tenantFilter<T extends { clientId: string }>(context: TenantContext, records: readonly T[]): T[] {
  if (!context.clientId) throw new TenantAccessError();
  return records.filter((record) => record.clientId === context.clientId);
}
