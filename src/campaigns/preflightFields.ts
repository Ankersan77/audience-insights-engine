export const PREFLIGHT_DIMENSIONS = ["strategy", "audience", "proposition", "distinctiveness", "cultural_permission", "channel_role", "feasibility"] as const;
export type PreflightDimension = typeof PREFLIGHT_DIMENSIONS[number];
