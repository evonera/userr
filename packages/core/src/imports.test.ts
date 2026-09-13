import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mapFeedbackCsv, parseCsv, previewFeedbackCsv } from "./imports.js";

test("maps Canny/Fider-shaped CSV rows without executing input", () => {
  const rows = mapFeedbackCsv('title,description,status,votes,id\n"Dark, mode","Use dark mode",open,12,old-1');
  assert.deepEqual(rows, [{ title: "Dark, mode", body: "Use dark mode", state: "open", voteCount: 12, externalId: "old-1" }]);
  assert.throws(() => parseCsv('title\n"unterminated'), /unterminated/);
  assert.throws(() => parseCsv('title\na"b"'), /quote/);
  const preview = previewFeedbackCsv("title,votes\n,9007199254740992");
  assert.deepEqual(preview[0].errors, ["title is required", "vote count must be a safe integer"]);
  assert.throws(() => mapFeedbackCsv("title,votes\n,1"), /validation errors/);
});
