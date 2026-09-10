import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI = "../src/index.mjs";

function nextProject() {
  return JSON.stringify({ dependencies: { next: "^15.0.0" } });
}

function runIn(root, args) {
  return spawnSync(
    process.execPath,
    [CLI, ...args, "--cwd", root],
    { cwd: new URL(".", import.meta.url), encoding: "utf8" },
  );
}

test("add dry-run lists convex pages without writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), nextProject());
    const result = runIn(root, ["add", "--dry-run", "--backend", "convex"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /app\/feedback\/page\.tsx/);
    assert.match(result.stdout, /app\/roadmap\/page\.tsx/);
    assert.match(result.stdout, /app\/changelog\/rss\/route\.ts/);
    assert.match(result.stdout, /No files were written/);
    assert.equal(existsSync(join(root, "app", "feedback", "page.tsx")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("add dry-run lists the neon api route", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), nextProject());
    const result = runIn(root, ["add", "--dry-run", "--backend", "neon"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /app\/api\/userr\/\[\.\.\.path\]\/route\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("add writes files and never overwrites conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), nextProject());
    const first = runIn(root, ["add", "--backend", "convex"]);
    assert.equal(first.status, 0, first.stderr);
    const target = join(root, "app", "roadmap", "page.tsx");
    assert.equal(existsSync(target), true);
    const second = runIn(root, ["add", "--backend", "convex"]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /unchanged/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated routes are fail-closed and escape feed output", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), nextProject());
    const result = runIn(root, ["add", "--backend", "neon"]);
    assert.equal(result.status, 0, result.stderr);
    const apiRoute = readFileSync(
      join(root, "app", "api", "userr", "[...path]", "route.ts"),
      "utf8",
    );
    assert.match(apiRoute, /never trust a client-sent/);
    assert.doesNotMatch(apiRoute, /x-actor/);
    const rss = readFileSync(
      join(root, "app", "changelog", "rss", "route.ts"),
      "utf8",
    );
    assert.match(rss, /\]\]&gt;/);
    assert.match(rss, /encodeURIComponent/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("add refuses non-Next projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), "{}\n");
    const result = runIn(root, ["add", "--dry-run"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Next\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("add rejects unknown backends", async () => {
  const root = await mkdtemp(join(tmpdir(), "userr-"));
  try {
    await writeFile(join(root, "package.json"), nextProject());
    const result = runIn(root, ["add", "--dry-run", "--backend", "sqlite"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
