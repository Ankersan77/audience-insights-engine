/**
 * The retained last30days path writes provider-shaped, identity-bearing rows.
 * It is migration scaffolding, not a canonical source adapter, and therefore
 * stays fail-closed unless an operator explicitly enables it for controlled
 * legacy data migration.
 */
export function legacyLast30DaysEnabled(
  value = process.env.ENABLE_LEGACY_LAST30DAYS,
): boolean {
  return value?.trim().toLowerCase() === "true";
}

