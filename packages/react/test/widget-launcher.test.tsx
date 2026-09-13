import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WidgetLauncher } from "../src/index.js";

afterEach(() => cleanup());

describe("WidgetLauncher", () => {
  test("mounts one isolated launcher and destroys it on unmount", () => {
    const { unmount } = render(
      <WidgetLauncher config={{ boardId: "board_1", submit: vi.fn() }} />,
    );
    expect(document.querySelectorAll("[data-userr-widget]")).toHaveLength(1);
    unmount();
    expect(document.querySelectorAll("[data-userr-widget]")).toHaveLength(0);
  });
});
