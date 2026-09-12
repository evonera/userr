# Convex component upgrades

## Phase 4 moderation index

Deploy the new component code, then have an authorized host-admin action run
the internal `items.backfillModeration` mutation once per board with
`{ boardId, paginationOpts: { cursor: null, numItems: 100 } }`. It is not a
public component endpoint.
Continue with the returned `continueCursor` until `isDone` is true. This writes
`moderation: "approved"` to feedback created before moderation existed, which
preserves its previous public visibility while allowing the indexed public
listing to paginate correctly. Complete this migration before directing public
portal traffic at the upgraded component.

## Versioned webhook events

New deliveries use `v1.*` event names and a versioned envelope. Existing saved
subscriptions with legacy names such as `post.created` are matched during the
compatibility period, so they continue receiving the corresponding v1 delivery.
New webhook configuration must use the v1 names.
