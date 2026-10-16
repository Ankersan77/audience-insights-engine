import { NextRequest, NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/src/lib/auth";
import { sessionTokenHash } from "@/src/lib/authTokens";
import { isAdmin } from "@/src/lib/roles";
import { parseBudgetEdit } from "@/src/core/budgetAdministration";
import { loadBudgetWorkspace } from "@/src/db/queries/budget_workspace";
import { setAcquisitionBudget } from "@/src/db/queries/acquisition_budget";
import { setSynthesisBudget } from "@/src/db/queries/synthesis_budget";
import { boundedJson } from "@/src/lib/boundedJson";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "authentication-required" }, 401);
  if (!isAdmin(session)) return json({ error: "budget-permission-denied" }, 403);
  return json(await loadBudgetWorkspace(session.clientId));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return json({ error: "authentication-required" }, 401);
  if (!isAdmin(session)) return json({ error: "budget-permission-denied" }, 403);
  const sessionHash = sessionTokenHash(request.cookies.get(SESSION_COOKIE)?.value);
  if (!sessionHash) return json({ error: "authentication-required" }, 401);
  let edit;
  try { edit = parseBudgetEdit(await boundedJson(request, 4096)); }
  catch { return json({ error: "budget-invalid-edit" }, 400); }
  const authority = { clientId: session.clientId, actorUserId: session.id, sessionHash, expectedVersion: edit.expectedVersion };
  try {
    if (edit.kind === "acquisition") await setAcquisitionBudget(session.clientSlug, edit.policy, authority);
    else await setSynthesisBudget(session.clientSlug, edit.policy, authority);
    return json(await loadBudgetWorkspace(session.clientId));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "budget-permission-denied") return json({ error: code }, 403);
    if (code === "budget-version-conflict") return json({ error: code }, 409);
    if (["budget-currency-change-requires-migration", "synthesis-budget-currency-change-requires-migration"].includes(code)) return json({ error: "budget-currency-locked" }, 409);
    // The transaction may already have committed if a subsequent read failed. Never auto-retry.
    return json({ error: "budget-save-unconfirmed" }, 503);
  }
}
