import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, ".cache");
const LIBRARY = join(CACHE_DIR, "lima.so");
const CLI = join(ROOT, "node_modules", ".bin", "tree-sitter");
const SAMPLE = join(CACHE_DIR, "query-check.lima");

function run(args: string[]) {
  return Bun.spawnSync(args, {
    cwd: ROOT,
    env: { ...process.env, XDG_CACHE_HOME: CACHE_DIR, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
}

mkdirSync(CACHE_DIR, { recursive: true });
writeFileSync(SAMPLE, [
  "title: Hello ${document.value}",
  "partial: $(cards/item.name)",
  "enabled: true",
  "nothing: null",
  "count: 42",
  "when: 2026-09-16",
  "quoted: \"line\\nvalue\" # note",
  "items: [one, two]",
  "",
].join("\n"));

const build = run([CLI, "build", "-o", LIBRARY]);
if (build.exitCode !== 0) throw new Error(build.stderr.toString());
const query = run([
  CLI,
  "query",
  "--captures",
  "--lib-path", LIBRARY,
  "--lang-name", "lima",
  join(ROOT, "queries", "highlights.scm"),
  SAMPLE,
]);
if (query.exitCode !== 0) {
  process.stderr.write(query.stdout.toString());
  process.stderr.write(query.stderr.toString());
  process.exit(1);
}

const output = query.stdout.toString();
const required = [
  "property",
  "string",
  "string.escape",
  "constant.builtin",
  "boolean",
  "number",
  "constant",
  "variable",
  "function",
  "comment",
  "punctuation.bracket",
  "punctuation.delimiter",
];
const missing = required.filter((capture) => !output.includes(` - ${capture},`));
if (missing.length) {
  console.error(`missing query captures: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`query compiled and produced ${required.length} required capture classes`);
