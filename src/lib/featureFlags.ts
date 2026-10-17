/**
 * The retained last30days path writes provider-shaped, identity-bearing rows.
 * It is migration scaffolding, not a canonical source adapter, and therefore
 * stays permanently disabled. Historical rows remain readable, but this path
 * cannot be used to ingest new data or draw from global provider credentials.
 */
export function legacyLast30DaysEnabled(
  _value = process.env.ENABLE_LEGACY_LAST30DAYS,
): boolean {
  void _value;
  return false;
}

