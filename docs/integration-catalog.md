# Integrations

Catalog of everything people will want to connect, modeled on BetterAuth's own
extension system (verified in `repos/better-auth`): **adapters** (DB drivers) vs
**plugins** (features: `admin`, `organization`, `two-factor`, `api-key`, `sso`,
`stripe`, `mcp`...) vs **social providers** (~40 OAuth: google/github/discord/slack/
linear/notion/microsoft...) vs **framework integrations** (`toNextJsHandler`,
node/sveltekit/tanstack/expo). Our equivalents: adapters = DB backends (see
`adapters.md`); plugins = two-way sync + notify + capture integrations below;
"social providers" = OAuth/SSO for the admin surface; handler factories = Convex
hooks vs `toNextJsHandler` (Neon).

Source for demand ranking: Canny (30+ native) + Featurebase + Quackback (25 providers:
asana, azure-devops, clickup, discord, freshdesk, github, gitlab, hubspot, intercom,
jira, linear, make, monday, n8n, notion, ntfy, salesforce, segment, shortcut, slack,
stripe, teams, trello, zapier, zendesk) + Reflet (GitHub two-way + Slack/Discord).

## P0 — ship with v1 (4 + generic webhook)
| Integration | Direction | What it does | Notes |
|---|---|---|---|
| Slack | out + in | Channel notifications (post/vote-milestone/comment/status); `/feedback` slash submit; `@bot` capture from thread | Canny/Featurebase #1 ask; Linear-style thread sync |
| Discord | out + in | Embed per post, PATCH on vote/status (stored `messageId` pattern from UserCue), DELETE on post delete; slash `/plan /ship` status change | Our audience lives in Discord; bot needs persistent connection (Docker/Railway, not Vercel serverless) |
| GitHub Issues | two-way | Push post → issue, link existing, status sync both ways, bot backlink comment | Reference impl: BugDrop (App JWT→installation token) + Reflet (`githubIssueId/Number/HtmlUrl`, webhook import) |
| Linear | two-way | Same contract as GitHub (push/link/status sync, assignee, estimates → roadmap ETA) | Modern-team default; Canny/Featurebase both lead with it |
| Generic webhook | out | HMAC-SHA256, `events[]`, `boardIds[]` filter, deliveries ledger | The escape hatch that covers Zapier/Make/n8n/Pabbly on day one (see `webhook.md`) |

## P1 — next (demand-proven)
- **Jira (Cloud)** — push/link/status sync, per-board project/issue-type mapping, multi-team rules (Featurebase's rules UI is the spec).
- **ClickUp / Asana / Monday / Trello / Shortcut / Azure DevOps** — same two-way issue contract, one shared `IssueTracker` plugin interface; build ClickUp first (Canny parity), rest are config.
- **Microsoft Teams** — notifications parity with Slack (AppSource path).
- **Intercom / Zendesk / Freshdesk / Help Scout** — support-queue capture (Autopilot pattern: scan closed tickets → suggested posts) + link tickets without leaving helpdesk.
- **HubSpot / Salesforce** — vote on behalf of contact/deal, revenue sort ("sort posts by $"), contact/company sync.
- **Segment** — user sync for segmentation; **PostHog/GA** — portal analytics.
- **Zapier / Make / n8n (native apps, not just webhook)** — trigger `post.created/status_changed`, actions create/update post; Quackback ships all three.
- **OIDC / Okta / Entra ID / Google Workspace (SSO)** — BetterAuth `sso` package pattern (OIDC discovery + SAML, verified domains, claim mapping); admin-surface only.

## P2 — later / signal-gated
- **Notion** (spec docs sync), **GitLab** (same contract as GitHub), **ntfy** (cheap push), **Stripe** (BA `stripe` pattern: billing hooks → revenue-segment feedback), **Chrome extension** (capture anywhere), **Gong/Zoom/Meet/Fathom/Fireflies/Grain/tl;dv** (call-transcript → suggested posts, Canny Autopilot), **G2/Capterra/Trustpilot/App Store/Play** (review ingestion), **MCP server** (`/api/mcp` + OAuth discovery, Claude/Cursor/ChatGPT read-write tools — Canny already ships this).

## Plugin contract (every integration implements this)
```
src/integrations/<id>/ { server.ts, ui.tsx, manifest.ts }
manifest: { id, name, category (tracker|chat|support|crm|automation|analytics|auth|ai),
            direction (out|in|two-way), eventsUsed[], configSchema (zod),
            statusMapping (theirStatus ↔ ourStatus), setupSteps[] }
server: { push(post) → externalId, link(postId, externalId), onInboundWebhook(payload),
          onStatusChange(post, status) → sync + notify }
ui: { configPanel, DestinationPicker, StatusSyncConfig } (Quackback reuse)
tests: folder-conformance + registry-capability-coverage (Quackback pattern)
```
- Server owns statuses/labels; client values are hints (BugDrop fail-closed rule).
- Every two-way sync stores `externalId + htmlUrl + lastSyncAt + syncStatus` on the post.
- Notifications never block mutations: scheduler/worker fan-out (BullMQ in Neon, component scheduler in Convex).
