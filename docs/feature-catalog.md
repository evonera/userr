# Features (exhaustive — all of Featurebase + gap-fillers)

Source repos: quackback, convex-feedback, fider, formbricks, logchimp, usercue,
bugdrop, reflet, budibase. Featurebase public features verified via web 2026.

## A. Boards & posts
- [ ] Multi-board from day one; public/private boards; custom slug/domain/CSS/logo/primaryColor
- [ ] Board settings: custom fields, allowAnonymousVoting, requireApproval, defaultStatus/View, cardStyle
- [ ] Post kinds: suggestion / bug / feedback / feature; categories + icons; tags (public/private, AI auto-tag)
- [ ] Pinned posts + pinned official response; locked threads; soft-delete + restore; ETA/deadline
- [ ] Follow-up questions (urgency / usage frequency / importance); monetary-value sort; Value-vs-Effort rank
- [ ] Attachments (Convex storage / S3, 5MB default, png/jpg/gif/webp/pdf/mp4)
- [ ] Full-text search (Convex search index / pg trigram + tsvector); filter by status/tag/board; sort top/new
- [ ] `/posts/:number/:slug` URLs; sitemap + robots + preventIndexing; Atom/RSS feeds; SEO/OG previews

## B. Voting
- [ ] Upvote-only default, optional downvote; idempotent toggle (`desiredState` pattern)
- [ ] `@@unique[authorId,postId]`; denormalized voteCount/commentCount; voter list
- [ ] Vote on behalf of users (admin subscribes them); revenue-sorted views; leaderboards

## C. Comments
- [ ] Threaded (parentId, maxDepth 5, tombstones preserving shape); lazy one-level fetch; ReplyList mount-on-expand
- [ ] Emoji reactions; @-mentions with notifications; edit history; TipTap markdown + sanitize (bluemonday/dompurify)
- [ ] Internal staff notes (`create_internal` / `view_internal` perms — LogChimp pattern)

## D. Admin triage (the anti-churn moat)
- [ ] Inbox: unreviewed sorted by votes; keyboard shortcuts (P=plan, C=close, M=merge); bulk close/spam
- [ ] Merge panel: vector-similar top-3 in sidebar, vote transfer, voter auto-notify, canonicalPostId/mergedAt/By
- [ ] Status machine: open / under_review / planned / in_progress / completed / closed + duplicate
- [ ] Kanban drag-drop status board; roadmapOrder persistence; changelog prompt on ship
- [ ] Moderation queue (approve/decline, approve-and-verify/decline-and-block); trust/block users; banReason/banExpires
- [ ] User segmentation (plan / revenue / custom attrs); activity timeline; CSV + backup-zip export

## E. Roadmap
- [ ] Public kanban Planned / In Progress / Shipped; showOnRoadmap flag; milestones (now/next/quarter/year)
- [ ] Columns from statuses/tags (isRoadmapLane, laneOrder); ETA display; linkable, screenshot-friendly

## F. Changelog
- [ ] Markdown entries + rich text editor; scheduled publish; version field; featured image
- [ ] Linked shipped posts (M:N join, auto-close loop); segmented visibility; subscriber list + unsubscribe tokens
- [ ] Email fan-out via host Resend hook; in-app popup + lightweight widget; RSS auto-generated

## G. Notifications (Canny killer feature)
- [ ] post_subscriptions{notifyComments, notifyStatusChanges} + preferences matrix (type × channel)
- [ ] In-app + email; status-change auto-notify voters ("we shipped X in v2.3"); vote milestones; weekly digest
- [ ] notifiedAt claim columns; webhook deliveries ledger (failureCount/lastError/lastTriggeredAt)

## H. Capture widget v1 (BugDrop parity)
- [ ] One-line install: `<script data-board data-theme data-color data-position data-locale>`
- [ ] `window.Feedback {open/close/hide/show/setTheme/registerFlow/registerVariant/submit}` + `feedback:ready` event
- [ ] Shadow DOM closed; theme tokens; color-mix accent; welcome-once; dismissible + draggable launcher; hotkey
- [ ] Categories bug/feature/question → server-mapped labels (fail-closed with warnings)
- [ ] Screenshot optional/auto/required; annotate (pen/rect/arrow/text/blur/highlight) + undo/clear + crop
- [ ] Privacy masking (`data-feedback-mask` + auto sensitive inputs, canvas redaction before upload)
- [ ] Element picker (selector + componentStack + source file/line + baked highlight border)
- [ ] Console-log bundle (caps: 50 entries / 12k chars / 1k per message) + system context (browser/OS/DPR/viewport/redacted URL)
- [ ] `registerFlow` declarative forms/screens/when/issue.sections (BugDrop) + survey triggers (Reflet: page_visit/time_delay/exit_intent/feedback_submitted, delayMs/sampleRate)
- [ ] Headless `registerVariant.submit()` for custom UI; server-controlled statuses/labels; dual rate limits; HMAC host token

## I. Auth / API / integrations
- [ ] Never own auth: `identify(ctx)` (Convex); BetterAuth admin plugin + guest default + createAccessControl (Neon)
- [ ] SSO/social via host; API keys (lookupHash + per-project read/write/manage); REST `/api/v1/*` + OpenAPI
- [ ] Outbound webhooks (HMAC-SHA256, events[], boardIds[] filter); inbound per-integration webhooks
- [ ] Native plugins (server+ui + conformance tests): Slack, Discord (embed PATCH via stored messageId), GitHub (two-way issue sync), Linear/Jira; generic Zapier/Make/n8n
- [ ] Canny/Fider CSV importer CLI; `GET /widget/config?publicKey` preflight

## J. AI (progressive, nullable columns — never required)
- [ ] Embeddings on create (text-embedding-3-small); similar-on-typing; duplicate-suggestion job; theme summaries
- [ ] Auto-tag; AI draft reply; semantic search; MCP read tools (post-v1)

## K. i18n / theming / targeting
- [ ] `messages` dict (no i18n runtime; Lingui/react-intl compatible); RTL; per-board locale; browser auto-detect
- [ ] shadcn theme tokens + primaryColor prop; dark default; custom CSS escape hatch
- [ ] Anti-nag targeting (Formbricks steal): displayOnce/Multiple + recontactDays + displayPercentage + placement
