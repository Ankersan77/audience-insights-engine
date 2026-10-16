export function classifyAcquisitionError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "unexpected";
  if (message.includes("rate-limit") || message.includes("rate limit") || message.includes("429")) return "rate-limit";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("transient") || message.includes("temporarily") || message.includes("econnreset")) return "transient";
  if (message.includes("adapter-unavailable")) return "adapter-unavailable";
  if (message.includes("credential")) return "credential-unavailable";
  if (message.includes("cancel")) return "cancelled";
  if (message.includes("rights") || message.includes("policy") || message.includes("quota") || message.includes("cost-limit") || message.includes("cost-unreported")) return "policy-rejected";
  return "adapter-failed";
}
