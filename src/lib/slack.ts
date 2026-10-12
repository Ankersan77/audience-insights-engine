/**
 * Slack channel directory lookup (T15) and message delivery (T23). Calls
 * Slack's `conversations.list`/`chat.postMessage` with the bot token
 * (`SLACK_BOT_TOKEN`, provisioned in SSM — see `.env.example`).
 *
 * `SLACK_BOT_TOKEN` is now provisioned (T18). The honest-failure path below
 * (`SlackNotConfiguredError`) stays in place for an environment where it
 * genuinely is absent; `SlackSendError` carries Slack's own rejection reason
 * for a `chat.postMessage` call (e.g. an invalid/nonexistent channel id)
 * without ever faking a successful send.
 */

export type SlackChannelOption = {
  id: string;
  name: string;
};

/** Thrown when `SLACK_BOT_TOKEN` is absent — distinct from a genuine Slack API failure. */
export class SlackNotConfiguredError extends Error {
  constructor(message = "Slack isn't connected yet.") {
    super(message);
    this.name = "SlackNotConfiguredError";
  }
}

type SlackConversationsListResponse = {
  ok: boolean;
  error?: string;
  channels?: Array<{ id: string; name: string; is_archived?: boolean }>;
};

/**
 * Lists Slack channels the bot token can see, filtered client-side (within
 * this function) to names containing `query`. `conversations.list` has no
 * server-side name search, so the full (paginated-once) list is fetched and
 * filtered here.
 */
export async function listChannels(query: string): Promise<SlackChannelOption[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new SlackNotConfiguredError();
  }

  const url = new URL("https://slack.com/api/conversations.list");
  url.searchParams.set("limit", "200");
  url.searchParams.set("types", "public_channel,private_channel");
  url.searchParams.set("exclude_archived", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await response.json()) as SlackConversationsListResponse;
  if (!response.ok || !data.ok) {
    throw new Error(`Slack API error: ${data.error ?? response.statusText}`);
  }

  const needle = query.trim().toLowerCase();
  return (data.channels ?? [])
    .filter((c) => !needle || c.name.toLowerCase().includes(needle))
    .map((c) => ({ id: c.id, name: c.name }));
}

/** A real, well-formed Slack API rejection (e.g. `channel_not_found`) — distinct from a network/parse failure. */
export class SlackSendError extends Error {
  constructor(
    message: string,
    public readonly slackError?: string,
  ) {
    super(message);
    this.name = "SlackSendError";
  }
}

type SlackPostMessageResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
};

/**
 * Sends an Insight's text to a Slack channel on acceptance (T23). Never
 * posted against a real, existing channel outside this app's own testing
 * (see the plan's hard rule) — call-shape verification uses a deliberately
 * invalid channel id instead, which still exercises this exact function.
 */
export async function sendMessage(channelId: string, text: string): Promise<{ ts: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new SlackNotConfiguredError();
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });

  const data = (await response.json()) as SlackPostMessageResponse;
  if (!data.ok) {
    throw new SlackSendError(`Slack rejected the message: ${data.error ?? "unknown error"}`, data.error);
  }
  return { ts: data.ts ?? "" };
}
