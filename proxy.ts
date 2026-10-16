import { NextRequest, NextResponse } from "next/server";
import { sameOriginWrite } from "@/src/lib/requestPolicy";

/** Origin protection only. Authentication and role checks remain in each route. */
export function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.cookies.has("market_research_session")
    && !sameOriginWrite(request.headers.get("origin"), request.url, process.env.APP_ORIGIN)) {
    return NextResponse.json({ error: "same-origin-request-required" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
