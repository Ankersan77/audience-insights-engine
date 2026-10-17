/** Shared browser/server heuristics. These are not a complete anonymity or injection guarantee. */
const IDENTIFIER_PATTERNS: readonly { name: string; pattern: RegExp; replacement: string }[] = [
  { name: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[redacted-email]" },
  { name: "social-handle", pattern: /(^|\s)@[a-z0-9_.-]{2,32}\b/gi, replacement: "$1[redacted-handle]" },
  { name: "forum-handle", pattern: /\b(?:u|user)\/[a-z0-9_-]{2,32}\b/gi, replacement: "[redacted-handle]" },
  { name: "profile-url", pattern: /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|instagram\.com|tiktok\.com|reddit\.com\/user)\/[^\s)]+/gi, replacement: "[redacted-profile-url]" },
  { name: "device-id", pattern: /\b(?:device|advertising|cookie)[-_ ]?id\s*[:=]\s*[a-z0-9-]{8,}\b/gi, replacement: "[redacted-device-id]" },
];
const INJECTION_PATTERNS = [/ignore (?:(?:all|any|the) )?previous instructions/i, /system prompt/i, /you are now/i, /developer message/i, /execute (?:this|the following) command/i];
export function redactIdentifiers(content: string): { content: string; redactions: string[]; identityRisk: boolean } {
  let redacted = content;
  const redactions: string[] = [];
  for (const rule of IDENTIFIER_PATTERNS) {
    const replaced = redacted.replace(rule.pattern, rule.replacement);
    if (replaced !== redacted) redactions.push(rule.name);
    redacted = replaced;
  }
  return { content: redacted, redactions, identityRisk: redactions.length > 0 };
}
export function hasPromptInjection(content: string): boolean { return INJECTION_PATTERNS.some((pattern) => pattern.test(content)); }
