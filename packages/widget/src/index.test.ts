import assert from "node:assert/strict";
import test from "node:test";
import { allowMetadata, captureScreenshot, redactUrl, sanitizeConsoleLogs, validateCapturePolicy } from "./index.js";

test("capture requires explicit consent and bounded host retention", () => {
  assert.deepEqual(sanitizeConsoleLogs(["one"], false), []);
  assert.throws(() => validateCapturePolicy({ screenshot: true }, undefined), /retentionMs/);
  assert.throws(() => validateCapturePolicy({ consoleLogs: true }, { retentionMs: 0 }), /retentionMs/);
  assert.doesNotThrow(() => validateCapturePolicy({ consoleLogs: true }, { retentionMs: 86_400_000 }));
});
test("screenshot hooks receive approved masks and cannot run without consent", async () => {
  const masks = [{ x: 1, y: 2, width: 3, height: 4 }];
  let received: unknown;
  const blob = await captureScreenshot({ consent: { screenshot: true }, capturePolicy: { retentionMs: 1, screenshotMasks: masks }, captureScreenshot: async (input) => { received = input; return new Blob(["masked"]); } });
  assert.ok(blob);
  assert.deepEqual(received, { masks, element: undefined });
  assert.equal(await captureScreenshot({ consent: {}, captureScreenshot: async () => new Blob() }), undefined);
});
test("capture helpers redact and bound host data", () => {
  assert.deepEqual(allowMetadata({ plan: "pro", token: "secret" }, ["plan"]), { plan: "pro" });
  assert.match(redactUrl("https://user:pass@example.test/a?token=secret&view=all"), /token=%5BREDACTED%5D/);
  assert.deepEqual(sanitizeConsoleLogs(["abcdef", "uvwxyz"], true, { maxConsoleEntries: 1, maxConsoleChars: 3 }), ["uvw"]);
});
