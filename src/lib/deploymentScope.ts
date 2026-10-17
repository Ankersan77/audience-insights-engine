/** Check configuration against the database identity without reading credentials. */
export function validateClientOwnedDeployment(
  environment: Readonly<Record<string, string | undefined>>,
  rows: readonly { id: number; slug: string }[],
): void {
  const slug = environment.MARKET_RESEARCH_CLIENT_SLUG?.trim();
  const id = environment.MARKET_RESEARCH_CLIENT_ID?.trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug) || !id || !/^[1-9]\d*$/.test(id)
    || !Number.isSafeInteger(Number(id)) || !environment.DATABASE_URL) throw new Error("client-owned-deployment-configuration-invalid");
  if (rows.length !== 1 || rows[0].id !== Number(id) || rows[0].slug !== slug)
    throw new Error("client-owned-database-scope-invalid");
}
