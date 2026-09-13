import { strict as assert } from "node:assert";
import { test } from "node:test";
import { discord, github, integrations, linear, slack, type TransportRequest } from "./index.js";

test("registry exposes the four Phase 6 provider manifests", () => {
  assert.deepEqual(integrations.map((entry) => entry.id), ["slack", "discord", "github", "linear"]);
  assert.ok(integrations.every((entry) => entry.fields.length > 0 && entry.setupSteps.length > 0));
});

test("chat adapters use a host-owned transport and retain Discord message ids", async () => {
  const seen: TransportRequest[] = [];
  const transport = async (request: TransportRequest) => { seen.push(request); return { status: 200, json: { id: "msg_1" } }; };
  await slack.notify(transport, "https://hooks.slack.test/a", { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 });
  assert.equal(await discord.createMessage(transport, "https://discord.test/hook", { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 }), "msg_1");
  await discord.updateMessage(transport, "https://discord.test/hook", "msg_1", { title: "Dark mode", url: "https://app.test/f/dark", state: "planned", votes: 3 });
  assert.equal(seen.length, 3);
  assert.match(seen[2].url, /messages\/msg_1$/);
  assert.deepEqual(slack.parseSlashCommand({ text: "Dark mode", user_id: "U1" }), { title: "Dark mode", actorId: "U1" });
  await assert.rejects(() => slack.notify(transport, "http://hooks.slack.test/a", { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 }), /HTTPS/);
  await assert.rejects(() => slack.notify(transport, "https://127.0.0.1/hook", { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 }), /private|loopback/i);
});

test("tracker adapters return links and fail closed on malformed inbound payloads", async () => {
  const githubTransport = async () => ({ status: 201, json: { id: 42, html_url: "https://github.test/issues/42", state: "open" } });
  const link = await github.createIssue(githubTransport, { repository: "owner/repo", token: "secret" }, { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 });
  assert.equal(link.externalId, "42");
  await assert.rejects(() => github.createIssue(githubTransport, { repository: "owner/repo/extra", token: "secret" }, { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 }), /owner\/name/);
  assert.equal(github.parseWebhook({ issue: { id: 42, state: "closed" } })?.state, "closed");
  assert.equal(github.parseWebhook({ issue: { id: "42" } }), null);
  const linearTransport = async () => ({ status: 200, json: { data: { issueCreate: { issue: { id: "lin_1", url: "https://linear.test/lin_1", state: { name: "Triage" } } } } } });
  assert.equal((await linear.createIssue(linearTransport, { teamId: "team", apiKey: "secret" }, { title: "Dark mode", url: "https://app.test/f/dark", state: "open", votes: 2 })).externalId, "lin_1");
  assert.equal(linear.parseWebhook({ data: { id: "lin_2", state: { name: "Done" } } })?.state, "Done");
  assert.equal(linear.parseWebhook({ data: { id: 2 } }), null);
});
