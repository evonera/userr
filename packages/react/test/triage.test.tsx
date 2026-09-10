import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import {
  ChangelogPublisher,
  FeedbackProvider,
  MergeReview,
  ModerationQueue,
  TriageInbox,
  type BoardItemView,
} from "../src/index.js";

afterEach(() => cleanup());

const items: BoardItemView[] = [
  {
    id: "i_1",
    title: "Dark mode",
    body: "",
    kind: "idea",
    state: "inbox",
    voteCount: 5,
    commentCount: 0,
    labels: [],
  },
  {
    id: "i_2",
    title: "CSV export",
    body: "",
    kind: "idea",
    state: "inbox",
    voteCount: 3,
    commentCount: 0,
    labels: [],
  },
];

function renderWithProvider(ui: React.ReactElement) {
  return render(<FeedbackProvider>{ui}</FeedbackProvider>);
}

describe("triage", () => {
  test("inbox selects and bulk-plans", async () => {
    const user = userEvent.setup();
    const onBulkState = vi.fn();
    renderWithProvider(<TriageInbox items={items} onBulkState={onBulkState} />);
    await user.click(screen.getByRole("checkbox", { name: /select dark mode/i }));
    await user.click(screen.getByRole("button", { name: /plan \(p\)/i }));
    expect(onBulkState).toHaveBeenCalledWith(["i_1"], "planned");
  });

  test("inbox keyboard shortcut closes selection", async () => {
    const user = userEvent.setup();
    const onBulkState = vi.fn();
    renderWithProvider(<TriageInbox items={items} onBulkState={onBulkState} />);
    await user.click(screen.getByRole("checkbox", { name: /select csv export/i }));
    await user.keyboard("c");
    expect(onBulkState).toHaveBeenCalledWith(["i_2"], "closed");
  });

  test("moderation queue reviews each report", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    renderWithProvider(
      <ModerationQueue items={items} onReview={onReview} />,
    );
    const spamButtons = screen.getAllByRole("button", { name: "Spam" });
    await user.click(spamButtons[0]);
    expect(onReview).toHaveBeenCalledWith("i_1", "spam");
  });

  test("merge review confirms the chosen target", async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();
    renderWithProvider(
      <MergeReview
        source={items[0]}
        candidates={[{ id: "i_9", title: "Night mode", voteCount: 12 }]}
        onMerge={onMerge}
      />,
    );
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /merge/i }));
    expect(onMerge).toHaveBeenCalledWith("i_1", "i_9");
  });

  test("publisher collects title, body, version, and links", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    renderWithProvider(
      <ChangelogPublisher
        shippedItems={[items[0]]}
        subscriberCount={42}
        onPublish={onPublish}
      />,
    );
    await user.type(screen.getByLabelText(/title/i), "2.3.0 ships");
    await user.type(screen.getByLabelText(/body/i), "Dark mode is here.");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /publish update/i }));
    expect(onPublish).toHaveBeenCalledWith({
      title: "2.3.0 ships",
      body: "Dark mode is here.",
      version: undefined,
      linkedItemIds: ["i_1"],
    });
    expect(screen.getByText(/notify 42 subscribers/i)).toBeDefined();
  });
});
