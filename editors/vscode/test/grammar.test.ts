/**
 * Grammar smoke test: loads syntaxes/lima.tmLanguage.json through
 * vscode-textmate + vscode-oniguruma (the exact engine VS Code uses) and
 * asserts that representative Lima constructs get the scopes we expect.
 *
 *   bun test
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";
import { CORPUS_GRAMMAR_CASES } from "../../shared/corpus-grammar-cases.js";

const HERE = import.meta.dir;
const GRAMMAR = join(HERE, "..", "syntaxes", "lima.tmLanguage.json");

const wasm = readFileSync(
  join(HERE, "..", "node_modules", "vscode-oniguruma", "release", "onig.wasm"),
);
const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
  createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s: string) => new oniguruma.OnigString(s),
}));

const registry = new textmate.Registry({
  onigLib,
  loadGrammar: async (scopeName) =>
    scopeName === "source.lima"
      ? textmate.parseRawGrammar(readFileSync(GRAMMAR, "utf8"), GRAMMAR)
      : null,
});

type ScopedToken = [string, string[], number, number];

async function scopesFor(code: string): Promise<ScopedToken[]> {
  const grammar = await registry.loadGrammar("source.lima");
  if (!grammar) throw new Error("grammar failed to load");
  const out: ScopedToken[] = [];
  let ruleStack = textmate.INITIAL;
  for (const line of code.split("\n")) {
    const r = grammar.tokenizeLine(line, ruleStack);
    for (const t of r.tokens) {
      const text = line.slice(t.startIndex, t.endIndex);
      out.push([text, t.scopes, t.startIndex, t.endIndex]);
    }
    ruleStack = r.ruleStack;
  }
  return out;
}

/** Does any emitted token whose text === `text` carry a scope matching `scope`? */
function has(
  tokens: ScopedToken[],
  text: string,
  scope: string,
): boolean {
  return tokens.some(
    ([t, scopes]) => t === text && scopes.some((s) => s.includes(scope)),
  );
}

function scopesAt(tokens: ScopedToken[], offset: number): string[] {
  const token = tokens.find(
    ([, , start, end]) => start <= offset && offset < end,
  );
  if (!token) throw new Error(`no TextMate token at UTF-16 offset ${offset}`);
  return token[1];
}

function carries(scopes: string[], scope: string): boolean {
  return scopes.some((candidate) => candidate.includes(scope));
}

test("comment and quote boundaries match the conformance corpus", async () => {
  const mismatches: string[] = [];
  for (const fixture of CORPUS_GRAMMAR_CASES) {
    const tokens = await scopesFor(fixture.input);
    for (let offset = 0; offset < fixture.input.length; offset++) {
      const shouldBeComment =
        fixture.commentStart !== null && offset >= fixture.commentStart;
      const hasComment = carries(scopesAt(tokens, offset), "comment");
      if (hasComment !== shouldBeComment) {
        mismatches.push(
          `${fixture.id}: comment scope at offset ${offset} was ${hasComment}, expected ${shouldBeComment}`,
        );
      }

      const quote = fixture.quoteRanges.find(
        ({ range: [start, end] }) => start <= offset && offset < end,
      );
      const scopes = scopesAt(tokens, offset);
      if (quote?.kind === "string") {
        if (!carries(scopes, `string.quoted.${quote.quote}`)) {
          mismatches.push(
            `${fixture.id}: missing ${quote.quote}-string scope at offset ${offset}`,
          );
        }
      } else if (quote?.kind === "key") {
        if (!carries(scopes, "entity.name.tag.lima")) {
          mismatches.push(
            `${fixture.id}: missing quoted-key scope at offset ${offset}`,
          );
        }
      } else if (!shouldBeComment) {
        if (carries(scopes, "string.quoted")) {
          mismatches.push(
            `${fixture.id}: unexpected quote scope at offset ${offset}`,
          );
        }
      }
    }
  }
  expect(mismatches).toEqual([]);
});

test("keys, comments, and the key/value colon", async () => {
  const t = await scopesFor("title: Hello # trailing\n# whole line\n");
  expect(has(t, "title", "entity.name.tag.lima")).toBe(true);
  expect(has(t, ":", "punctuation.separator.key-value.lima")).toBe(true);
  expect(t.some(([x, s]) => x.includes("trailing") && s.some((y) => y.includes("comment")))).toBe(true);
  expect(t.some(([x, s]) => x.includes("whole line") && s.some((y) => y.includes("comment")))).toBe(true);
});

test("a # need not be preceded by whitespace to start a comment", async () => {
  const t = await scopesFor("tight-comment: hello#literal\n");
  expect(has(t, "#", "comment.line.number-sign.lima")).toBe(true);
  expect(has(t, "literal", "comment.line.number-sign.lima")).toBe(true);
  expect(
    t.some(([x, s]) => x.includes("hello") && s.some((y) => y.includes("comment"))),
  ).toBe(false);
});

test("an escaped \\# stays literal; a real # after it still starts a comment", async () => {
  const t = await scopesFor(
    "escaped-hash: hello\\#literal\nescaped-then-comment: hello\\#literal#actual\n",
  );
  expect(
    t.some(([x, s]) => x.includes("\\#literal") && s.some((y) => y.includes("comment"))),
  ).toBe(false);
  expect(has(t, "#", "comment.line.number-sign.lima")).toBe(true);
  expect(has(t, "actual", "comment.line.number-sign.lima")).toBe(true);
});

test("a # inside a quoted string stays literal; one right after the closing quote is a comment", async () => {
  const t = await scopesFor(
    'quoted-hash: "hello#not-a-comment"\nquoted-then-comment: "hello#literal"#outer\n',
  );
  expect(
    t.some(
      ([x, s]) =>
        x.includes("#not-a-comment") &&
        s.some((y) => y.includes("string.quoted.double")) &&
        !s.some((y) => y.includes("comment")),
    ),
  ).toBe(true);
  expect(
    t.some(([x, s]) => x.includes("outer") && s.some((y) => y.includes("comment"))),
  ).toBe(true);
});

test("scalars: bool, null, number, date", async () => {
  const t = await scopesFor(
    "a: true\nb: null\nc: -12.5e3\nd: 2026-08-12\ne: 2026-08-12T09:00:00Z\nf: 11.08.2026\n",
  );
  expect(has(t, "true", "constant.language.boolean.lima")).toBe(true);
  expect(has(t, "null", "constant.language.null.lima")).toBe(true);
  expect(has(t, "-12.5e3", "constant.numeric.lima")).toBe(true);
  expect(has(t, "2026-08-12", "constant.other.date.lima")).toBe(true);
  expect(has(t, "2026-08-12T09:00:00Z", "constant.other.date.lima")).toBe(true);
  expect(has(t, "11.08.2026", "constant.other.date.lima")).toBe(true);
});

test("References 2.0: ${document} and $(partial) tokens are references", async () => {
  const t = await scopesFor(
    "a: ${title}\nb: Hello ${first.name}!\nc: $(author.name)\nd: $(persons/alice.city)\n",
  );
  expect(has(t, "${title}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "${first.name}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "$(author.name)", "variable.other.reference.partial.lima")).toBe(true);
  expect(has(t, "$(persons/alice.city)", "variable.other.reference.partial.lima")).toBe(true);
});

test("References 1.0 ($key)/(%key) are NOT highlighted as references", async () => {
  const t = await scopesFor("a: ($key)\nb: (%partial)\n");
  expect(has(t, "($key)", "variable.other.reference")).toBe(false);
  expect(has(t, "(%partial)", "variable.other")).toBe(false);
});

test("a reference inside a double-quoted string stays literal", async () => {
  const t = await scopesFor('a: "literal ${title} here"\n');
  expect(has(t, "${title}", "variable.other.reference.document.lima")).toBe(false);
  expect(t.some(([x, s]) => x.includes("${title}") && s.some((y) => y.includes("string.quoted.double")))).toBe(true);
});

test("literal block scalar marker is |, folded > is not a marker", async () => {
  const t = await scopesFor("text: |\n  body line\n");
  expect(has(t, "|", "keyword.operator.block-scalar.lima")).toBe(true);
  const folded = await scopesFor("text: >\n  body line\n");
  expect(has(folded, ">", "keyword.operator.block-scalar.lima")).toBe(false);
});

test("^^ continuation marker at line start", async () => {
  const t = await scopesFor("text: |\n  first\n  ^^second\n");
  expect(has(t, "^^", "keyword.operator.line-continuation.lima")).toBe(true);
});

test("double-quoted escapes: valid vs unknown", async () => {
  const t = await scopesFor('a: "ok \\n \\u00e9 \\\\ bad \\q"\n');
  expect(has(t, "\\n", "constant.character.escape.lima")).toBe(true);
  expect(has(t, "\\u00e9", "constant.character.escape.lima")).toBe(true);
  expect(has(t, "\\q", "invalid.illegal.unknown-escape.lima")).toBe(true);
});

test("flow sequence and flow mapping", async () => {
  const t = await scopesFor("a: [1, two, ${r}]\nb: {x: 1, y: two}\n");
  expect(has(t, "[", "punctuation.definition.sequence.begin.lima")).toBe(true);
  expect(has(t, "]", "punctuation.definition.sequence.end.lima")).toBe(true);
  expect(has(t, "{", "punctuation.definition.mapping.begin.lima")).toBe(true);
  expect(has(t, "${r}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "x", "entity.name.tag.lima")).toBe(true);
});

test("an apostrophe inside an unquoted value does not open a string", async () => {
  const t = await scopesFor(
    "tagline: leaving out much of YAML's broader grammar.\nnext: still fine\n",
  );
  // nothing on either line should be scoped as a single-quoted string
  expect(t.some(([, s]) => s.some((y) => y.includes("string.quoted.single")))).toBe(false);
  expect(has(t, "next", "entity.name.tag.lima")).toBe(true);
});

test("a genuine single-quoted value still highlights", async () => {
  const t = await scopesFor("a: 'hello world'\nb: [x, 'y']\n");
  expect(t.some(([x, s]) => x.includes("hello world") && s.some((y) => y.includes("string.quoted.single")))).toBe(true);
  expect(has(t, "y", "string.quoted.single")).toBe(true);
});

test("block sequence dash", async () => {
  const t = await scopesFor("items:\n  - one\n  - two\n");
  expect(has(t, "-", "punctuation.definition.list.begin.lima")).toBe(true);
});
