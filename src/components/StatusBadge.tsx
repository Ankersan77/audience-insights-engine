// The full set of run and insight statuses named in product-spec.md:
// Run status (FR12): queued | running | succeeded | failed | cancelled.
// Insight status (FR16/FR17): pending | accepted | discarded.
// Insight delivery state (FR18a): "delivery failed", shown as its own
// distinct badge rather than folded into `pending`/`accepted`/`discarded`.
export type Status =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "pending"
  | "accepted"
  | "discarded"
  | "delivery failed";

type StatusConfig = { label: string; bg: string; text: string };

const STATUS_CONFIG: Record<Status, StatusConfig> = {
  queued: {
    label: "Queued",
    bg: "var(--status-neutral-bg)",
    text: "var(--status-neutral-text)",
  },
  running: {
    label: "Running",
    bg: "var(--status-info-bg)",
    text: "var(--status-info-text)",
  },
  succeeded: {
    label: "Succeeded",
    bg: "var(--status-success-bg)",
    text: "var(--status-success-text)",
  },
  failed: {
    label: "Failed",
    bg: "var(--status-danger-bg)",
    text: "var(--status-danger-text)",
  },
  cancelled: {
    label: "Cancelled",
    bg: "var(--status-neutral-bg)",
    text: "var(--status-neutral-text)",
  },
  pending: {
    label: "Pending",
    bg: "var(--status-warning-bg)",
    text: "var(--status-warning-text)",
  },
  accepted: {
    label: "Accepted",
    bg: "var(--status-success-bg)",
    text: "var(--status-success-text)",
  },
  discarded: {
    label: "Discarded",
    bg: "var(--status-neutral-bg)",
    text: "var(--status-neutral-text)",
  },
  "delivery failed": {
    label: "Delivery failed",
    bg: "var(--status-danger-bg)",
    text: "var(--status-danger-text)",
  },
};

/** The statuses every call site can rely on existing, in display order. */
export const ALL_STATUSES = Object.keys(STATUS_CONFIG) as Status[];

/** Semantic-coloured pill for a run or insight status. Colour comes only from
 * the `--status-*` tokens in `src/styles/tokens.css` — never a raw hex value. */
export function StatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}
