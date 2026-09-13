import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundlePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/widget.v1.js");

test("browser IIFE keeps submission data inside the host privacy boundary", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Host app</title>" }));
  await page.goto("https://example.test/account?token=secret&view=public");
  await page.addScriptTag({ path: bundlePath });
  await page.evaluate(() => {
    (window as unknown as { currentHostToken: string }).currentHostToken = "initial-token";
    const browserBundle = (window as unknown as { Feedback: { bootstrap(config: unknown): unknown } }).Feedback;
    (window as unknown as { submission?: unknown; Feedback: unknown }).Feedback = browserBundle.bootstrap({
      boardId: "public-board",
      getHostToken: () => (window as unknown as { currentHostToken: string }).currentHostToken,
      allowedCategories: ["bug"],
      metadata: { plan: "pro", token: "host-secret" },
      metadataAllowlist: ["plan"],
      consent: { consoleLogs: false },
      submit: async (submission: unknown) => { (window as unknown as { submission: unknown }).submission = submission; },
    });
  });

  await expect(page.locator("[data-userr-widget]")).toHaveCount(1);
  const submission = await page.evaluate(async () => {
    (window as unknown as { currentHostToken: string }).currentHostToken = "refreshed-host-token";
    const widget = (window as unknown as { Feedback: { submit(input: unknown): Promise<void> } }).Feedback;
    await widget.submit({ title: "Broken", body: "Steps", category: "bug", consoleLogs: ["private log"] });
    return (window as unknown as { submission: { metadata: unknown; url: string; consoleLogs: string[] } }).submission;
  });
  expect(submission.metadata).toEqual({ plan: "pro" });
  expect((submission as typeof submission & { hostToken: string }).hostToken).toBe("refreshed-host-token");
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

test("screenshot edits paint privacy masks after annotations", async ({ page }) => {
  await page.setContent("<!doctype html><title>Screenshot host</title>"); await page.addScriptTag({ path: bundlePath });
  const result = await page.evaluate(async () => {
    const source = document.createElement("canvas"); source.width = 8; source.height = 8; const sourceContext = source.getContext("2d")!; sourceContext.fillStyle = "#ff0000"; sourceContext.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve, reject) => source.toBlob((value) => value ? resolve(value) : reject(new Error("source export failed")), "image/png"));
    const browserBundle = (window as unknown as { Feedback: { bootstrap(config: unknown): { editScreenshot(source: Blob, options: unknown): Promise<Blob> } } }).Feedback;
    const widget = browserBundle.bootstrap({ boardId: "screenshots", allowedCategories: [], submit: async () => {} });
    const edited = await widget.editScreenshot(blob, { annotations: [{ type: "highlight", x: 0, y: 0, width: 8, height: 8, color: "#00ff00" }], masks: [{ x: 0, y: 0, width: 4, height: 4 }] });
    const bitmap = await createImageBitmap(edited); const output = document.createElement("canvas"); output.width = 8; output.height = 8; const outputContext = output.getContext("2d")!; outputContext.drawImage(bitmap, 0, 0); bitmap.close();
    return { type: edited.type, masked: Array.from(outputContext.getImageData(1, 1, 1, 1).data), visible: Array.from(outputContext.getImageData(6, 6, 1, 1).data) };
  });
  expect(result.type).toBe("image/png"); expect(result.masked.slice(0, 3)).toEqual([17, 17, 17]); expect(result.visible.slice(0, 3)).toEqual([0, 255, 0]);
});
