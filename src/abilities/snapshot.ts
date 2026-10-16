import { createHash } from "node:crypto";

/** JSON key order is not semantic; PostgreSQL JSONB may reorder nested keys. */
export function researchSnapshotDigest(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
    return item;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
