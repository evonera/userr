import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("dry-run detects a project without writing generated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), "{}\n");
    const result = spawnSync(process.execPath, ["../dist/index.mjs", "init", "--dry-run", "--cwd", root], { cwd: new URL(".", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No files were written/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
