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
};
