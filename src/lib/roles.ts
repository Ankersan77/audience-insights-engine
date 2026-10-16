import { getSession, type Role, type SessionUser } from "@/src/lib/auth";
import { canResearchRole, canReviewRole, isAdminRole } from "@/src/lib/rolePolicy";

/**
 * Server-side role helper (UX review required finding 1 / FR22): every
 * admin-only control must not be rendered at all for a `viewer`, never
 * rendered-then-disabled. Call this from a server component and branch on the
 * result; there is no client-side `useRole()` hook, because the render
 * decision has to happen before the client ever receives the markup.
 */
export async function getCurrentRole(): Promise<Role | null> {
  const session = await getSession();
  return session?.role ?? null;
}

export function isAdmin(user: SessionUser | null): boolean {
  return isAdminRole(user?.role);
}

export function canResearch(user: SessionUser | null): boolean {
  return canResearchRole(user?.role);
}

export function canReview(user: SessionUser | null): boolean {
  return canReviewRole(user?.role);
}

/**
 * Throws a 403 for a direct write to an admin-only API route from a
 * non-admin session. `permission-denied` is reserved for exactly this case —
 * a viewer who never saw the control but hit the route directly.
 */
export class PermissionDeniedError extends Error {
  constructor(message = "permission-denied") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function assertAdmin(user: SessionUser | null): asserts user is SessionUser {
  if (!isAdmin(user)) {
    throw new PermissionDeniedError();
  }
}

export function assertResearchWrite(user: SessionUser | null): asserts user is SessionUser {
  if (!canResearch(user)) throw new PermissionDeniedError("research-write-denied");
}

export function assertReview(user: SessionUser | null): asserts user is SessionUser {
  if (!canReview(user)) throw new PermissionDeniedError("review-denied");
}
