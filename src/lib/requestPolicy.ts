/** Cookie-authenticated writes must originate from the owned web surface, not a sibling site. */
export function sameOriginWrite(origin: string | null, requestUrl: string, configuredOrigin?: string): boolean {
  if (!origin || origin === "null") return false;
  try {
    const expected = new URL(configuredOrigin || requestUrl);
    const supplied = new URL(origin);
    return ["http:", "https:"].includes(expected.protocol) && supplied.origin === expected.origin && origin === supplied.origin;
  } catch { return false; }
}
