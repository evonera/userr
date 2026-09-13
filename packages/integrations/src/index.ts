/**
 * Headless integration adapters. Hosts render `config.fields` in their own
 * admin UI and supply both credentials and a guarded fetch implementation.
 * Userr deliberately never reads environment variables or owns provider keys.
 */
export type IntegrationId = "slack" | "discord" | "github" | "linear";
export type IntegrationDirection = "out" | "in" | "two-way";
export type ConfigField = { key: string; label: string; secret?: boolean; required?: boolean; help?: string };
export interface IntegrationManifest {
  id: IntegrationId;
  name: string;
  direction: IntegrationDirection;
  events: readonly string[];
  fields: readonly ConfigField[];
  setupSteps: readonly string[];
}
export interface TransportRequest { url: string; method: "POST" | "PATCH" | "DELETE"; headers: Record<string, string>; body?: unknown; }
export interface TransportResponse { status: number; json?: unknown; }
export type IntegrationTransport = (request: TransportRequest) => Promise<TransportResponse>;
export interface FeedbackNotification { title: string; body?: string; url: string; state: string; votes: number; }
export interface IssueLink { externalId: string; url?: string; state?: string; }

function success(response: TransportResponse, name: string): void {
  if (response.status < 200 || response.status >= 300) throw new Error(`${name} request failed with ${response.status}.`);
}
function safeWebhookUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Webhook URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Webhook URL must be HTTPS and must not contain credentials.");
  return url;
}
function githubRepository(value: string): string {
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error("GitHub repository must be owner/name.");
  return parts.map(encodeURIComponent).join("/");
}

export const integrations: readonly IntegrationManifest[] = [
  { id: "slack", name: "Slack", direction: "two-way", events: ["post.created", "post.status_changed", "comment.created", "vote.milestone"], fields: [{ key: "webhookUrl", label: "Incoming webhook URL", secret: true, required: true }, { key: "signingSecret", label: "Signing secret", secret: true }], setupSteps: ["Create an incoming webhook for a channel.", "Store its URL in your host secret store.", "Verify signed slash-command requests before calling the host intake flow."] },
  { id: "discord", name: "Discord", direction: "two-way", events: ["post.created", "post.status_changed", "vote.milestone"], fields: [{ key: "webhookUrl", label: "Channel webhook URL", secret: true, required: true }], setupSteps: ["Create a Discord channel webhook.", "Store its URL in your host secret store.", "Use the returned message ID to PATCH status and vote updates."] },
  { id: "github", name: "GitHub Issues", direction: "two-way", events: ["post.created", "post.status_changed"], fields: [{ key: "repository", label: "Repository (owner/name)", required: true }, { key: "token", label: "Installation token", secret: true, required: true }], setupSteps: ["Install your GitHub App for the target repository.", "Mint installation tokens in the host only.", "Verify GitHub webhook signatures before importing an issue update."] },
  { id: "linear", name: "Linear", direction: "two-way", events: ["post.created", "post.status_changed"], fields: [{ key: "teamId", label: "Team ID", required: true }, { key: "apiKey", label: "API key", secret: true, required: true }], setupSteps: ["Create a Linear OAuth app or personal integration.", "Store the token in the host secret store.", "Verify inbound webhooks and map Linear workflows to Userr states."] },
];

export const slack = {
  manifest: integrations[0],
  async notify(transport: IntegrationTransport, webhookUrl: string, item: FeedbackNotification): Promise<void> {
    const response = await transport({ url: safeWebhookUrl(webhookUrl).toString(), method: "POST", headers: { "content-type": "application/json" }, body: { text: `*${item.title}* — ${item.state} (${item.votes} votes)\n${item.url}` } });
    success(response, "Slack");
  },
  parseSlashCommand(input: { text?: unknown; user_id?: unknown }): { title: string; actorId: string } | null {
    if (typeof input.text !== "string" || !input.text.trim() || typeof input.user_id !== "string" || !input.user_id) return null;
    return { title: input.text.trim(), actorId: input.user_id };
  },
};

export const discord = {
  manifest: integrations[1],
  async createMessage(transport: IntegrationTransport, webhookUrl: string, item: FeedbackNotification): Promise<string | null> {
    const url = safeWebhookUrl(webhookUrl); url.searchParams.set("wait", "true");
    const response = await transport({ url: url.toString(), method: "POST", headers: { "content-type": "application/json" }, body: { embeds: [{ title: item.title, description: item.body ?? "", url: item.url, fields: [{ name: "Status", value: item.state, inline: true }, { name: "Votes", value: String(item.votes), inline: true }] }] } });
    success(response, "Discord");
    const body = response.json;
    return typeof body === "object" && body !== null && "id" in body && typeof body.id === "string" ? body.id : null;
  },
  async updateMessage(transport: IntegrationTransport, webhookUrl: string, messageId: string, item: FeedbackNotification): Promise<void> {
    const url = safeWebhookUrl(webhookUrl); url.search = ""; url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}`;
    const response = await transport({ url: url.toString(), method: "PATCH", headers: { "content-type": "application/json" }, body: { embeds: [{ title: item.title, description: item.body ?? "", url: item.url, fields: [{ name: "Status", value: item.state, inline: true }, { name: "Votes", value: String(item.votes), inline: true }] }] } });
    success(response, "Discord");
  },
};

export const github = {
  manifest: integrations[2],
  async createIssue(transport: IntegrationTransport, config: { repository: string; token: string }, item: FeedbackNotification): Promise<IssueLink> {
    const response = await transport({ url: `https://api.github.com/repos/${githubRepository(config.repository)}/issues`, method: "POST", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: { title: item.title, body: `${item.body ?? ""}\n\n[View feedback](${item.url})` } });
    success(response, "GitHub");
    const body = response.json as { id?: unknown; html_url?: unknown; state?: unknown } | undefined;
    if (typeof body?.id !== "number") throw new Error("GitHub response did not contain an issue id.");
    return { externalId: String(body.id), url: typeof body.html_url === "string" ? body.html_url : undefined, state: typeof body.state === "string" ? body.state : undefined };
  },
  parseWebhook(input: unknown): IssueLink | null {
    if (!input || typeof input !== "object" || !("issue" in input)) return null;
    const issue = (input as { issue: unknown }).issue;
    if (!issue || typeof issue !== "object") return null;
    const value = issue as { id?: unknown; html_url?: unknown; state?: unknown };
    return typeof value.id === "number" ? { externalId: String(value.id), url: typeof value.html_url === "string" ? value.html_url : undefined, state: typeof value.state === "string" ? value.state : undefined } : null;
  },
};

export const linear = {
  manifest: integrations[3],
  async createIssue(transport: IntegrationTransport, config: { teamId: string; apiKey: string }, item: FeedbackNotification): Promise<IssueLink> {
    const response = await transport({ url: "https://api.linear.app/graphql", method: "POST", headers: { authorization: config.apiKey, "content-type": "application/json" }, body: { query: "mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id url state { name } } } }", variables: { input: { teamId: config.teamId, title: item.title, description: `${item.body ?? ""}\n\n${item.url}` } } } });
    success(response, "Linear");
    const issue = (response.json as { data?: { issueCreate?: { issue?: { id?: unknown; url?: unknown; state?: { name?: unknown } } } } } | undefined)?.data?.issueCreate?.issue;
    if (typeof issue?.id !== "string") throw new Error("Linear response did not contain an issue id.");
    return { externalId: issue.id, url: typeof issue.url === "string" ? issue.url : undefined, state: typeof issue.state?.name === "string" ? issue.state.name : undefined };
  },
  parseWebhook(input: unknown): IssueLink | null {
    if (!input || typeof input !== "object") return null;
    const data = (input as { data?: unknown }).data;
    if (!data || typeof data !== "object") return null;
    const value = data as { id?: unknown; url?: unknown; state?: { name?: unknown } };
    return typeof value.id === "string" ? { externalId: value.id, url: typeof value.url === "string" ? value.url : undefined, state: typeof value.state?.name === "string" ? value.state.name : undefined } : null;
  },
};
