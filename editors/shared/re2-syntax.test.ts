/**
 * Every pattern of the editor grammars is RE2 syntax, as the maintainer
 * decided: no lookaround, backreference, atomic group or possessive
 * quantifier. Go's regexp/syntax is the judge (re2-syntax/main.go); Emacs
 * regexps have their own syntax, which has none of these constructs.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as fragments from "./grammar-fragments.js";

const ROOT = resolve(__dirname, "../..");
const CHECKER = resolve(__dirname, "re2-syntax/main.go");
const TIMEOUT_MS = 120_000;

/** Lookbehind, lookahead, a backreference, an atomic group, a possessive quantifier. */
const NOT_RE2 = [String.raw`(?<!\\)#`, "a(?=b)", String.raw`(a)\1`, "(?>a)", "a*+"];

test("every TextMate, Sublime and shared pattern is RE2 syntax", () => {
  const patterns = [
    ...textMatePatterns("editors/vscode/syntaxes/lima.tmLanguage.json"),
    ...textMatePatterns("editors/vscode/syntaxes/lima.markdown-injection.json"),
    ...sublimePatterns("editors/lsp/syntaxes/lima.sublime-syntax"),
    ...Object.entries(fragments)
      .filter(([name, value]) => typeof value === "string" && !name.startsWith("EMACS_"))
      .map(([name, value]) => ({ where: `grammar-fragments.ts ${name}`, pattern: value as string })),
  ];
  expect(patterns.length).toBeGreaterThan(40);

  const errors = re2Errors([...patterns.map(({ pattern }) => pattern), ...NOT_RE2]);
  const rejected = patterns.flatMap(({ where, pattern }, index) =>
    errors[index] === null ? [] : [`${where}: ${pattern}: ${errors[index]}`],
  );
  expect(rejected).toEqual([]);
  // the checker does reject what RE2 cannot read
  expect(errors.slice(patterns.length).every((error) => error !== null)).toBe(true);
}, TIMEOUT_MS);

interface Located {
  where: string;
  pattern: string;
}

/** The `match`, `begin`, `end` and `while` patterns of a TextMate grammar. */
function textMatePatterns(path: string): Located[] {
  const found: Located[] = [];
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) node.forEach((child, index) => walk(child, `${at}[${index}]`));
    else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (["match", "begin", "end", "while"].includes(key) && typeof value === "string") {
          found.push({ where: `${path} ${at}.${key}`, pattern: value });
        } else walk(value, `${at}.${key}`);
      }
    }
  };
  walk(JSON.parse(readFileSync(resolve(ROOT, path), "utf8")), "");
  return found;
}

/** The `match` patterns of a Sublime syntax, which has no variables to expand. */
function sublimePatterns(path: string): Located[] {
  const syntax = Bun.YAML.parse(readFileSync(resolve(ROOT, path), "utf8")) as {
    variables?: unknown;
    contexts: Record<string, unknown>;
  };
  if (syntax.variables !== undefined) {
    throw new Error(`${path}: expand its variables before checking its patterns`);
  }
  const found: Located[] = [];
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) node.forEach((child, index) => walk(child, `${at}[${index}]`));
    else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "match" && typeof value === "string") {
          found.push({ where: `${path} ${at}`, pattern: value });
        } else walk(value, `${at}.${key}`);
      }
    }
  };
  walk(syntax.contexts, "contexts");
  return found;
}

/** Runs the Go checker, which Go must be installed for. */
function re2Errors(patterns: string[]): (string | null)[] {
  const run = () =>
    Bun.spawnSync({
      cmd: ["go", "run", CHECKER],
      stdin: Buffer.from(JSON.stringify(patterns)),
      stdout: "pipe",
      stderr: "pipe",
      timeout: TIMEOUT_MS,
    });
  let result: ReturnType<typeof run>;
  try {
    result = run();
  } catch (error) {
    throw new Error(`the RE2 syntax check needs Go on the PATH: ${error}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `go run re2-syntax/main.go failed (${result.exitCode ?? result.signalCode}): ${result.stderr.toString()}`,
    );
  }
  const errors = JSON.parse(result.stdout.toString()) as (string | null)[];
  if (errors.length !== patterns.length) {
    throw new Error(`the RE2 checker answered ${errors.length} of ${patterns.length} patterns`);
  }
  return errors;
}
