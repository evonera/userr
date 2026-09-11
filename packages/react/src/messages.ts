/**
 * Copy overrides, not an i18n runtime. Pass partial `messages` to
 * `FeedbackProvider` to reword or translate every user-facing string.
 * Compatible with any i18n framework: resolve translations in the host and
 * hand the dictionary in.
 */
export interface FeedbackMessages {
  boardSearchPlaceholder: string;
  boardSubmitIdea: string;
  boardEmpty: string;
  boardLoadMore: string;
  sortTop: string;
  sortNew: string;
  filterAll: string;
  voteFor: (title: string) => string;
  comments: (count: number) => string;
  reply: string;
  replyPlaceholder: (author: string) => string;
  commentDeleted: string;
  formTitleLabel: string;
  formBodyLabel: string;
  formKindLabel: string;
  formSubmit: string;
  formSubmitting: string;
  formError: string;
  similarHeading: string;
  subscribe: string;
  unsubscribe: string;
  roadmapEmptyLane: string;
  changelogEmpty: string;
  publishedOn: (date: string) => string;
  triageInbox: string;
  triageEmpty: string;
  selectAll: string;
  bulkPlan: string;
  bulkClose: string;
  bulkSelected: (count: number) => string;
  moderationQueue: string;
  approve: string;
  reject: string;
  markSpam: string;
  report: string;
  mergeReview: string;
  mergeInto: string;
  mergeConfirm: string;
  mergeVotesTransfer: (count: number) => string;
  publishChangelog: string;
  changelogTitleLabel: string;
  changelogBodyLabel: string;
  changelogVersionLabel: string;
  linkShippedItems: string;
  notifySubscribers: (count: number) => string;
  shortcutsHelp: string;
}

export const defaultMessages: FeedbackMessages = {
  boardSearchPlaceholder: "Search feedback…",
  boardSubmitIdea: "Submit idea",
  boardEmpty: "No feedback yet. Be the first to share an idea.",
  boardLoadMore: "Load more",
  sortTop: "Top",
  sortNew: "New",
  filterAll: "All",
  voteFor: (title) => `Vote for ${title}`,
  comments: (count) => `${count} comment${count === 1 ? "" : "s"}`,
  reply: "Reply",
  replyPlaceholder: () => "Write a reply…",
  commentDeleted: "This comment was deleted.",
  formTitleLabel: "What would you like to share?",
  formBodyLabel: "Details",
  formKindLabel: "Type",
  formSubmit: "Submit feedback",
  formSubmitting: "Submitting…",
  formError: "Could not submit feedback.",
  similarHeading: "Similar requests",
  subscribe: "Subscribe",
  unsubscribe: "Unsubscribe",
  roadmapEmptyLane: "Nothing here yet.",
  changelogEmpty: "No updates published yet.",
  publishedOn: (date) => `Published ${date}`,
  triageInbox: "Triage inbox",
  triageEmpty: "Inbox zero. Everything is reviewed.",
  selectAll: "Select all",
  bulkPlan: "Plan",
  bulkClose: "Close",
  bulkSelected: (count) => `${count} selected`,
  moderationQueue: "Moderation queue",
  approve: "Approve",
  reject: "Reject",
  markSpam: "Spam",
  report: "Report",
  mergeReview: "Merge duplicates",
  mergeInto: "Merge into",
  mergeConfirm: "Merge",
  mergeVotesTransfer: (count) =>
    `Up to ${count} source vote${count === 1 ? "" : "s"} transfer (excluding overlaps)`,
  publishChangelog: "Publish update",
  changelogTitleLabel: "Title",
  changelogBodyLabel: "Body (markdown)",
  changelogVersionLabel: "Version (optional)",
  linkShippedItems: "Link shipped items",
  notifySubscribers: (count) =>
    `Notify ${count} subscriber${count === 1 ? "" : "s"} via your email hook`,
  shortcutsHelp: "p plan · c close · m merge · ? shortcuts",
};
