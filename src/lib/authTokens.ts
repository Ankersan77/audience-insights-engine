import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TenantRole } from "../core/tenancy.ts";

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const FLOW_MAX_AGE_SECONDS = 10 * 60;
export type SessionUser = { id: number; clientId: number; clientSlug: string; email: string; name: string; role: TenantRole; ssoSubjectId: string };
export type FlowState = { state: string; nonce: string; codeVerifier: string; returnTo: string };

export function validTenantRole(value: unknown): value is TenantRole {
  return typeof value === "string" && ["owner", "admin", "researcher", "reviewer", "viewer"].includes(value);
}

export function newSessionToken(): string { return `s1_${randomBytes(32).toString("base64url")}`; }
export function sessionTokenHash(token: string | undefined): string | null {
  if (!token || !/^s1_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u0020\u007f]/.test(value) ? value : "/projects";
}

function signature(payload: string, secret: string): string {
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeFlowCookie(flow: FlowState, secret: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ ...flow, returnTo: safeReturnPath(flow.returnTo), purpose: "oidc-flow", version: 1, issuedAt, expiresAt: issuedAt + FLOW_MAX_AGE_SECONDS })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function decodeFlowCookie(token: string | undefined, secret: string, now = Date.now()): FlowState | null {
  if (!token || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const expected = Buffer.from(signature(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const time = Math.floor(now / 1000);
    if (!value || value.purpose !== "oidc-flow" || value.version !== 1 || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
      || value.issuedAt > time || value.expiresAt <= time || value.expiresAt - value.issuedAt !== FLOW_MAX_AGE_SECONDS) return null;
    if (![value.state, value.nonce, value.codeVerifier].every((item) => typeof item === "string" && item.length > 0 && item.length <= 1024)) return null;
    return { state: value.state, nonce: value.nonce, codeVerifier: value.codeVerifier, returnTo: safeReturnPath(value.returnTo) };
  } catch { return null; }
}
