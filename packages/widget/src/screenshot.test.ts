import assert from "node:assert/strict";
import test from "node:test";
import { editScreenshot } from "./screenshot.js";

test("screenshot editing rejects unsafe requests before decoding", async () => {
  await assert.rejects(editScreenshot(new Blob(), { masks: [{ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }] }), /finite/);
  await assert.rejects(editScreenshot(new Blob(), { annotations: Array.from({ length: 101 }, () => ({ type: "text" as const, x: 0, y: 0, text: "x" })) }), /limited to 100/);
});
