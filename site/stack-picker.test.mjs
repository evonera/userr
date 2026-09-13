import assert from "node:assert/strict";
import test from "node:test";
import { commandFor } from "./stack-picker.mjs";

test("stack picker produces only supported local install commands", () => {
  assert.equal(commandFor(), "npx userr init --backend convex --framework next");
  assert.equal(commandFor({ backend: "neon" }), "npx userr init --backend neon --framework next");
  assert.throws(() => commandFor({ backend: "supabase" }), /Unsupported/);
});
