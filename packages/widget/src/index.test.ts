import assert from "node:assert/strict";
import test from "node:test";
import { allowMetadata, redactUrl, sanitizeConsoleLogs, validateCapturePolicy } from "./index.js";

test("capture requires explicit consent and bounded host retention", () => {
  assert.deepEqual(sanitizeConsoleLogs(["one"], false), []);
  assert.throws(() => validateCapturePolicy({ screenshot: true }, undefined), /retentionMs/);
  assert.throws(() => validateCapturePolicy({ consoleLogs: true }, { retentionMs: 0 }), /retentionMs/);
  assert.doesNotThrow(() => validateCapturePolicy({ consoleLogs: true }, { retentionMs: 86_400_000 }));
});
test("capture helpers redact and bound host data", () => {
  assert.deepEqual(allowMetadata({ plan: "pro", token: "secret" }, ["plan"]), { plan: "pro" });
  assert.match(redactUrl("https://user:pass@example.test/a?token=secret&view=all"), /token=%5BREDACTED%5D/);
  assert.deepEqual(sanitizeConsoleLogs(["abcdef", "uvwxyz"], true, { maxConsoleEntries: 1, maxConsoleChars: 3 }), ["uvw"]);
});
