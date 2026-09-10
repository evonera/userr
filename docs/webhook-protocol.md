# Webhooks (generic outbox + Discord/Slack details)

The generic webhook is the P0 integration that makes every other automation tool
(Zapier/Make/n8n/Pabbly) work on day one without native apps. Design follows
Quackback (`webhooks{secret encrypted, events[], board_ids[], status, failure_count,
last_error, last_triggered_at}` + deliveries ledger) + Fider (admin CRUD + test/preview
+ custom headers/method) + Formbricks (`Webhook{triggers, source, secret, surveyIds}`).

## Events (canonical names — never rename, only add)
```
post.created · post.updated · post.status_changed · post.merged · post.deleted
comment.created · vote.created (milestone-only: 10/25/50/100 to avoid spam)
changelog.published · roadmap.changed
```
Admin subscribes per-hook: `events[]` + `boardIds[]` (empty = all boards).

## Payload envelope (every event, both backends)
```json
{
  "id": "wh_evt_01J...",
  "type": "post.status_changed",
  "occurredAt": "2026-09-10T20:55:00.000Z",
  "board": { "id": "b_...", "slug": "feedback", "name": "Feedback" },
  "data": {
    "post": { "id": "p_...", "slug": "dark-mode-abc123", "title": "Dark mode",
               "status": "shipped", "previousStatus": "in_progress",
               "voteCount": 47, "url": "https://app.com/feedback/dark-mode-abc123" },
    "actor": { "id": "u_...", "role": "admin" }
  }
}
```

## Signing (HMAC-SHA256, Discord/Slack-compatible verification)
- Header `X-Feedback-Signature: sha256=<hex>` over raw body with per-hook `secret`
  (generated at creation, stored encrypted, rotatable, never logged).
- Header `X-Feedback-Event` = event name; `X-Feedback-Delivery` = delivery id (idempotency key).
- Receiver example (Node): `crypto.timingSafeEqual(received, expected)`.

## Delivery guarantees
- Async only: mutations enqueue, scheduler/worker POSTs (Convex component scheduler;
  BullMQ worker on Neon). Never block the vote/comment path.
- Retry with backoff (immediate, 1m, 5m, 30m, 2h, 12h), then mark hook `failing`
  after N consecutive failures (`failureCount/lastError/lastTriggeredAt` columns);
  per-delivery rows (`status: delivered/failed/pending`, attempts, response code).
- Timeout 10s; 410/404 auto-disables hook (dead endpoint hygiene).

## Discord specifics
- Native mode (recommended): bot posts rich embed per new post into mapped channel;
  store Discord `messageId` on the post; on vote/status change **PATCH the same message**
  (UserCue pattern), DELETE on post delete. Slash commands `/plan /ship /close` change
  status without leaving Discord. Needs persistent gateway connection → Docker/Railway,
  document the Vercel-serverless caveat.
- Webhook mode (no bot): plain Discord channel webhook URL; embed `{title, description,
  color, url, fields: [Status, Votes, Category], author}`; subscribe per board + event filter.

## Slack specifics
- Channel notifications for post/comment/vote-milestone/status (per-channel event config);
  unfurl post URLs; `/feedback <title>` creates post; `@bot` mention in thread captures
  message as post (dedupe via `findSimilar` before creating); Linear-style thread sync
  (replies sync both ways) as P1.

## Admin UX (CLI-scaffolded `/admin/feedback/integrations`)
- Table: name · url · events · boards · status (healthy/failing/disabled) · last delivery.
- Actions: create (URL + secret auto-gen + event/board pickers), test ping
  (`{type:"test", ...}` + preview pane, Fider pattern), rotate secret, disable, view deliveries.
- `userr.config.ts` hook alternative for code-first users:
```ts
export default { onStatusChange: async ({ post, newStatus, voters }) => {
  if (newStatus === "shipped")
    await resend.emails.send({ to: voters.map(v => v.email),
      subject: `"${post.title}" shipped!` });
}}
```

## Security
- HTTPS-only URLs (reject localhost except dev flag); custom headers support (Fider);
  secret rotation without downtime (accept N-1 during grace); redacted URLs in logs;
  per-board scoping prevents cross-board leaks; rate-limit inbound provider webhooks
  (GitHub/Linear) separately from outbound deliveries.
