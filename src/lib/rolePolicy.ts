import type { TenantRole } from "../core/tenancy.ts";

export function isAdminRole(role: TenantRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canResearchRole(role: TenantRole | null | undefined): boolean {
  return Boolean(role && ["owner", "admin", "researcher"].includes(role));
}

export function canReviewRole(role: TenantRole | null | undefined): boolean {
  return Boolean(role && ["owner", "admin", "reviewer"].includes(role));
}

