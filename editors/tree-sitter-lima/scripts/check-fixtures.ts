import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerator } from "../../../corpus/runner/src/generators/index";

const ROOT = process.cwd();
const CORPUS_DIR = join(ROOT, "..", "..", "corpus");
const CACHE_DIR = join(ROOT, ".cache");
const INPUT_DIR = join(CACHE_DIR, "fixtures");
const LIBRARY = join(CACHE_DIR, "lima.so");
const CLI = join(ROOT, "node_modules", ".bin", "tree-sitter");

interface Fixture {
  id: string;
  input?: string;
  inputFile?: string;
  generator?: { name: string; parameters: Record<string, unknown> };
  expect: { result?: unknown; error?: { code: string; line?: number } };
}

const SYNTACTIC_CODES = new Set([
  "INVALID_FLOW_SYNTAX",
  "INVALID_INDENTATION",
  "INVALID_QUOTE",
  "INVALID_ESCAPE",
  "UNRECOGNIZED_LINE",
]);

function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Fixture)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function inputFor(fixture: Fixture): string {
  if (fixture.input !== undefined) return fixture.input;
  if (fixture.inputFile !== undefined) {
    throw new Error(`${fixture.id}: inputFile must be resolved relative to its fixture file`);
  }
  if (fixture.generator) {
    return runGenerator(fixture.generator.name, fixture.generator.parameters).input;
  }
  throw new Error(`${fixture.id}: fixture has no input source`);
}

function run(args: string[]) {
  return Bun.spawnSync(args, {
    cwd: ROOT,
    env: { ...process.env, XDG_CACHE_HOME: CACHE_DIR },
    stdout: "pipe",
    stderr: "pipe",
  });
}

mkdirSync(INPUT_DIR, { recursive: true });
const build = run([CLI, "build", "-o", LIBRARY]);
if (build.exitCode !== 0) {
  process.stderr.write(build.stderr.toString());
  process.exit(1);
}

// Core 1.1: the Core 1.0 fixtures it supersedes stay (the grammar is tolerant either way), and its own join
const fixtures = [
  ...loadFixtures(join(CORPUS_DIR, "core")),
  ...loadFixtures(join(CORPUS_DIR, "core-1.1")),
  ...loadFixtures(join(CORPUS_DIR, "references-2.0")),
];
const resolved = fixtures.map((fixture, index) => {
  const input = inputFor(fixture);
  const safeId = fixture.id.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = join(INPUT_DIR, `${String(index).padStart(3, "0")}-${safeId}.lima`);
  writeFileSync(path, input);
  return { fixture, input, path };
});

const pathsFile = join(CACHE_DIR, "fixture-paths.txt");
writeFileSync(pathsFile, resolved.map(({ path }) => path).join("\n") + "\n");
const parsed = run([
  CLI,
  "parse",
  "--lib-path", LIBRARY,
  "--lang-name", "lima",
  "--json-summary",
  "--paths", pathsFile,
]);

let summaries: Array<{ file: string; successful: boolean }>;
try {
  const output = parsed.stdout.toString();
  const jsonStart = output.indexOf('{\n  "parse_summaries"');
  if (jsonStart < 0) throw new Error("tree-sitter emitted no JSON summary");
  summaries = JSON.parse(output.slice(jsonStart)).parse_summaries;
} catch {
  process.stderr.write(parsed.stderr.toString());
  process.stderr.write("Unable to decode tree-sitter JSON summary\n");
  process.exit(1);
}
const successByPath = new Map(summaries.map((summary) => [summary.file, summary.successful]));

const failures: string[] = [];
let successContracts = 0;
let semanticErrors = 0;
let syntaxErrors = 0;
let tolerantSyntaxErrors = 0;

for (const { fixture, path } of resolved) {
  const successful = successByPath.get(path);
  if (successful === undefined) {
    failures.push(`${fixture.id}: no parser summary`);
    continue;
  }
  const error = fixture.expect.error;
  if (!error) {
    successContracts++;
    if (!successful) failures.push(`${fixture.id}: expected an error-free syntax tree`);
    continue;
  }
  if (!SYNTACTIC_CODES.has(error.code)) {
    semanticErrors++;
    if (!successful) failures.push(`${fixture.id}: semantic-only error produced ERROR/MISSING`);
    continue;
  }

  syntaxErrors++;
  if (successful) {
    tolerantSyntaxErrors++;
    continue;
  }
  if (error.line !== undefined) {
    const detail = run([CLI, "parse", "--lib-path", LIBRARY, "--lang-name", "lima", path]);
    const match = /(?:ERROR|MISSING)[^\[]*\[(\d+),\s*(\d+)\]/.exec(
      detail.stdout.toString() + detail.stderr.toString(),
    );
    const actualLine = match ? Number(match[1]) + 1 : undefined;
    if (actualLine !== error.line) {
      failures.push(`${fixture.id}: ERROR/MISSING line ${actualLine ?? "unknown"}, expected ${error.line}`);
    }
  }
}

console.log(`fixtures: ${fixtures.length}/${fixtures.length} materialized`);
console.log(`success contracts: ${successContracts}`);
console.log(`semantic-only error contracts: ${semanticErrors}`);
console.log(`syntax-error contracts: ${syntaxErrors} (${tolerantSyntaxErrors} parsed through tolerant recovery)`);
if (failures.length) {
  console.error(`contract failures: ${failures.length}`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("contract failures: 0");
