import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WidgetLauncher } from "../src/index.js";
import { allowMetadata, redactUrl, sanitizeConsoleLogs } from "@userr/widget";

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

describe("widget privacy helpers", () => {
  test("allowlists metadata, redacts URLs, and requires log consent", () => {
    expect(allowMetadata({ plan: "pro", email: "secret@example.com" }, ["plan"])).toEqual({ plan: "pro" });
    expect(redactUrl("https://app.example.test/x?token=abc&view=all")).toContain("token=[REDACTED]");
    expect(sanitizeConsoleLogs(["secret"], false)).toEqual([]);
  });
});
