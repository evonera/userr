import { describe, expect, test, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

afterEach(() => cleanup());

import {
  BoardList,
  ChangelogList,
  FeedbackProvider,
  ItemDetail,
  RoadmapBoard,
  SubmitDialog,
  toBoardItemView,
  type BoardItemView,
} from "../src/index.js";

const item: BoardItemView = {
  id: "i_1",
  title: "Dark mode",
  body: "Please add dark mode.",
  kind: "idea",
  state: "planned",
  voteCount: 47,
  commentCount: 3,
  labels: ["theme"],
};

function renderWithProvider(ui: React.ReactElement) {
  return render(<FeedbackProvider>{ui}</FeedbackProvider>);
}

describe("surfaces", () => {
  test("board lists items with vote counts and statuses", async () => {
    const user = userEvent.setup();
    const onVote = vi.fn();
    renderWithProvider(
      <BoardList items={[item]} votedIds={new Set()} onVote={onVote} />,
    );
    expect(screen.getByText("Dark mode")).toBeDefined();
    expect(screen.getByText("47")).toBeDefined();
    expect(screen.getByText("planned")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /vote for dark mode/i }));
    expect(onVote).toHaveBeenCalledWith("i_1");
  });

  test("board shows the empty state", () => {
    renderWithProvider(<BoardList items={[]} />);
    expect(screen.getByText(/no feedback yet/i)).toBeDefined();
  });

  test("detail renders body, comments count, and thread", () => {
    renderWithProvider(
      <ItemDetail
        item={item}
        comments={[
          {
            id: "c_1",
            itemId: "i_1",
            actorId: "carol",
            body: "I need this.",
            createdAt: Date.now(),
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Dark mode" })).toBeDefined();
    expect(screen.getByText("I need this.")).toBeDefined();
  });

  test("roadmap groups items under lanes", () => {
    renderWithProvider(
      <RoadmapBoard
        lanes={[{ id: "l_1", name: "Now", states: ["planned"], order: 0 }]}
        itemsByLane={{ l_1: [item] }}
      />,
    );
    expect(screen.getByText("Now")).toBeDefined();
    expect(screen.getByText("Dark mode")).toBeDefined();
  });

  test("changelog renders markdown entries", () => {
    renderWithProvider(
      <ChangelogList
        entries={[
          {
            id: "e_1",
            title: "2.3.0",
            slug: "2-3-0",
            body: "**Shipped** dark mode.",
            version: "2.3.0",
            createdAt: Date.now(),
          },
        ]}
      />,
    );
    expect(screen.getByText("2.3.0")).toBeDefined();
    expect(screen.getByText("Shipped")).toBeDefined();
  });

  test("submit dialog opens the form", async () => {
    const user = userEvent.setup();
    renderWithProvider(<SubmitDialog onSubmit={() => {}} />);
    await user.click(screen.getByRole("button", { name: /submit idea/i }));
    expect(
      screen.getByLabelText(/what would you like to share/i),
    ).toBeDefined();
  });

  test("messages override rewords surfaces", () => {
    render(
      <FeedbackProvider messages={{ boardEmpty: "Nothing here, friend." }}>
        <BoardList items={[]} />
      </FeedbackProvider>,
    );
    expect(screen.getByText("Nothing here, friend.")).toBeDefined();
  });
});

describe("view normalizers", () => {
  test("toBoardItemView maps Convex and REST rows alike", () => {
    expect(
      toBoardItemView({ _id: "abc", title: "T", voteCount: 2 }),
    ).toMatchObject({ id: "abc", title: "T", voteCount: 2, kind: "feedback" });
    expect(
      toBoardItemView({ id: "xyz", title: "T", voteCount: 2 }),
    ).toMatchObject({ id: "xyz" });
  });
});
