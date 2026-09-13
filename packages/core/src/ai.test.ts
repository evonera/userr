import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tryComplete } from "./ai.js";

test("text generation remains optional and failure-observable", async () => {
  assert.deepEqual(await tryComplete(undefined, "summarize"), { text: null, reason: "unconfigured" });
  assert.deepEqual(await tryComplete({ complete: async () => "  concise summary  " }, "summarize"), { text: "concise summary" });
  assert.deepEqual(await tryComplete({ complete: async () => { throw new Error("offline"); } }, "summarize"), { text: null, reason: "provider_error" });
});
