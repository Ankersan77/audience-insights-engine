import { NextRequest, NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/src/lib/auth";
import { sessionTokenHash } from "@/src/lib/authTokens";
import { isAdmin } from "@/src/lib/roles";
import { boundedJson } from "@/src/lib/boundedJson";
import { companyContextEnvelope, saveCompanyContext } from "@/src/db/queries/company_context";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return json({ error: "authentication-required" }, 401);
  if (request.nextUrl.search) return json({ error: "company-context-query-not-supported" }, 400);
  return json(await companyContextEnvelope(session.clientId));
}
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return json({ error: "authentication-required" }, 401);
  if (!isAdmin(session)) return json({ error: "company-context-permission-denied" }, 403);
  const sessionHash = sessionTokenHash(request.cookies.get(SESSION_COOKIE)?.value);
  if (!sessionHash) return json({ error: "authentication-required" }, 401);
  let body;
  try { body = await boundedJson(request, 65536); } catch { return json({ error: "company-context-invalid" }, 400); }
  try {
    const current = await saveCompanyContext({ clientId: session.clientId, actorUserId: session.id, sessionHash }, body);
    return json({ current }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["company-context-invalid", "company-context-source-invalid", "company-context-review-date-invalid"].includes(code)) return json({ error: code }, 400);
    if (code === "company-context-version-conflict") return json({ error: code }, 409);
    if (code === "company-context-permission-denied") return json({ error: code }, 403);
    return json({ error: "company-context-save-unconfirmed" }, 503);
  }
}
