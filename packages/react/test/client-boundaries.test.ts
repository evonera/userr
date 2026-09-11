import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Server-safe modules: no React runtime, no Radix/dnd/convex imports.
const SERVER_MODULES = new Set([
  "cn.ts",
  "index.ts",
  "messages.ts",
  "rest.ts",
  "views.ts",
]);

const CLIENT_IMPORT = new RegExp(
  [
    "from\\s+[\"']react[\"']",
    "from\\s+[\"']convex/react[\"']",
    "@radix-ui/",
    "@dnd-kit/",
  ].join("|"),
);

describe("client boundaries", () => {
  test("every interactive module declares use client", () => {
    const dir = join(__dirname, "..", "src");
    const problems: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      const needsDirective =
        !SERVER_MODULES.has(file) && CLIENT_IMPORT.test(source);
      const hasDirective = source.startsWith('"use client"');
      if (needsDirective && !hasDirective) problems.push(`missing: ${file}`);
      if (SERVER_MODULES.has(file) && hasDirective) {
        problems.push(`unneeded: ${file}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
