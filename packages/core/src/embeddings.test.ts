import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tryEmbed, tryEmbedResult } from "./embeddings.js";

test("embedding failure never blocks lexical fallback", async () => {
  assert.equal(await tryEmbed(undefined, "hello"), null);
  assert.equal(await tryEmbed({ dimensions: 2, embed: async () => { throw new Error("down"); } }, "hello"), null);
  assert.equal(await tryEmbed({ dimensions: 2, embed: async () => [1] }, "hello"), null);
  assert.deepEqual(await tryEmbed({ dimensions: 2, embed: async () => [1, 2] }, "hello"), [1, 2]);
  assert.equal((await tryEmbedResult({ dimensions: 2, embed: async () => { throw new Error("down"); } }, "hello")).reason, "provider_error");
});
