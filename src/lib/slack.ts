/**
 * Slack channel directory lookup, used by the Slack picker on the Channel
 * management screen (T15). Calls Slack's `conversations.list` with the bot
 * token (`SLACK_BOT_TOKEN`, provisioned in SSM — see `.env.example`).
 *
 * `SLACK_BOT_TOKEN` is not provisioned in this environment (Credential-blocked
 * epics, E5): there is no live round trip to verify yet. The honest-failure
 * path below (`SlackNotConfiguredError`) is what the UI renders instead of
 * crashing or faking channel data.
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
