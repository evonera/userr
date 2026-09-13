import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mapFeedbackCsv, parseCsv } from "./imports.js";

test("maps Canny/Fider-shaped CSV rows without executing input", () => {
  const rows = mapFeedbackCsv('title,description,status,votes,id\n"Dark, mode","Use dark mode",open,12,old-1');
  assert.deepEqual(rows, [{ title: "Dark, mode", body: "Use dark mode", state: "open", voteCount: 12, externalId: "old-1" }]);
  assert.throws(() => parseCsv('title\n"unterminated'), /unterminated/);
});
