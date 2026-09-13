import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundlePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/widget.v1.js");

test("browser IIFE keeps submission data inside the host privacy boundary", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Host app</title>" }));
  await page.goto("https://example.test/account?token=secret&view=public");
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(() => {
    const browserBundle = (window as unknown as { Feedback: { bootstrap(config: unknown): unknown } }).Feedback;
    (window as unknown as { submission?: unknown; Feedback: unknown }).Feedback = browserBundle.bootstrap({
      boardId: "public-board",
      allowedCategories: ["bug"],
      metadata: { plan: "pro", token: "host-secret" },
      metadataAllowlist: ["plan"],
      consent: { consoleLogs: false },
      submit: async (submission: unknown) => { (window as unknown as { submission: unknown }).submission = submission; },
    });
  });

  await expect(page.locator("[data-userr-widget]")).toHaveCount(1);
  const submission = await page.evaluate(async () => {
    const widget = (window as unknown as { Feedback: { submit(input: unknown): Promise<void> } }).Feedback;
    await widget.submit({ title: "Broken", body: "Steps", category: "bug", consoleLogs: ["private log"] });
    return (window as unknown as { submission: { metadata: unknown; url: string; consoleLogs: string[] } }).submission;
  });
  expect(submission.metadata).toEqual({ plan: "pro" });
  expect(submission.url).toContain("token=%5BREDACTED%5D");
  expect(submission.url).toContain("view=public");
  expect(submission.consoleLogs).toEqual([]);

  const deniedCategory = await page.evaluate(async () => {
    const widget = (window as unknown as { Feedback: { submit(input: unknown): Promise<void> } }).Feedback;
    try { await widget.submit({ title: "No", body: "No", category: "feature" }); return "allowed"; } catch (error) { return (error as Error).message; }
  });
  expect(deniedCategory).toContain("not allowed");

  await page.evaluate(() => (window as unknown as { Feedback: { hide(): void } }).Feedback.hide());
  await expect(page.locator("[data-userr-widget]")).toBeHidden();
  await page.evaluate(() => { const widget = (window as unknown as { Feedback: { show(): void; destroy(): void } }).Feedback; widget.show(); widget.destroy(); });
  await expect(page.locator("[data-userr-widget]")).toHaveCount(0);
});
