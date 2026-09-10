#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); return index === -1 ? fallback : args[index + 1] ?? fallback; };
const has = (flag) => args.includes(flag);

function usage() {
  console.log("Usage: userr <init|doctor|upgrade> [--backend convex] [--framework next] [--dry-run] [--cwd path]");
}

function detect(root) {
  const packagePath = join(root, "package.json");
  const packageJson = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, "utf8")) : null;
  const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  return { hasPackage: Boolean(packageJson), next: Boolean(dependencies.next || existsSync(join(root, "app"))), convex: Boolean(dependencies.convex || existsSync(join(root, "convex"))) };
}

function filesFor({ backend, framework }) {
  if (backend !== "convex") throw new Error(`Backend '${backend}' is planned but not installable yet. Available: convex.`);
  if (framework !== "next") throw new Error(`Framework '${framework}' is planned but not installable yet. Available: next.`);
  return {
    "userr.config.ts": `export default {\n  boardSlug: "feedback",\n  portalPath: "/feedback",\n  adminPath: "/admin/feedback",\n};\n`,
    "app/feedback/page.tsx": `import { FeedbackProvider } from "@userr/react";\n\nexport default function FeedbackPage() {\n  return <FeedbackProvider><main><h1>Feedback</h1>{/* Connect this page to your host Convex wrapper. */}</main></FeedbackProvider>;\n}\n`,
    ".userr/README.md": `# Userr\n\nGenerated files are safe to edit. Add the Convex component to \`convex/convex.config.ts\`, create authenticated host wrappers, then connect the generated portal to those wrappers.\n`,
  };
}

async function init() {
  const root = resolve(value("--cwd", process.cwd())); const backend = value("--backend", "convex"); const framework = value("--framework", "next"); const dryRun = has("--dry-run");
  const detected = detect(root); const files = filesFor({ backend, framework });
  if (!detected.hasPackage) throw new Error(`No package.json found in ${root}. Run inside an application project.`);
  console.log(`Userr: ${backend} + ${framework}${dryRun ? " (dry run)" : ""}`);
  console.log(`Detected: Next=${detected.next}, Convex=${detected.convex}`);
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative); const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    const action = current === content ? "unchanged" : current === null ? "create" : "conflict";
    console.log(`${action.padEnd(9)} ${relative}`);
    if (!dryRun && action === "create") { await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, "utf8"); }
  }
  if (!dryRun) await writeFile(join(root, ".userr", "manifest.json"), JSON.stringify({ version: 1, backend, framework, files: Object.keys(files) }, null, 2) + "\n");
  console.log(dryRun ? "No files were written." : "Generated files written. Existing files were never overwritten.");
}

function doctor() {
  const root = resolve(value("--cwd", process.cwd())); const detected = detect(root);
  if (!detected.hasPackage) throw new Error(`No package.json found in ${root}.`);
  const checks = [
    ["Next.js project", detected.next],
    ["Convex installed", detected.convex],
    ["userr.config.ts", existsSync(join(root, "userr.config.ts"))],
    ["generated manifest", existsSync(join(root, ".userr", "manifest.json"))],
  ];
  for (const [name, passed] of checks) console.log(`${passed ? "✓" : "✗"} ${name}`);
  if (!detected.next || !detected.convex) process.exitCode = 1;
}

async function upgrade() {
  console.log("Upgrade uses the installer’s non-overwrite policy.");
  await init();
}

if (!args[0] || has("--help")) usage();
else if (args[0] === "init") init().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
else if (args[0] === "doctor") { try { doctor(); } catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; } }
else if (args[0] === "upgrade") upgrade().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
else { usage(); process.exitCode = 1; }
