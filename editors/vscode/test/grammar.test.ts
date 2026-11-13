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
const INJECTION = join(HERE, "..", "syntaxes", "lima.markdown-injection.json");

const wasm = readFileSync(
  join(HERE, "..", "node_modules", "vscode-oniguruma", "release", "onig.wasm"),
);
const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
  createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s: string) => new oniguruma.OnigString(s),
}));

const registry = new textmate.Registry({
  onigLib,
  loadGrammar: async (scopeName) => {
    const path = { "source.lima": GRAMMAR, "lima.frontmatter.injection": INJECTION }[
      scopeName
    ];
    return path ? textmate.parseRawGrammar(readFileSync(path, "utf8"), path) : null;
  },
});

type ScopedToken = [string, string[], number, number];

async function scopesFor(
  code: string,
  scopeName = "source.lima",
): Promise<ScopedToken[]> {
  const grammar = await registry.loadGrammar(scopeName);
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

test("Core 1.2 Unicode and gendered keys use the key scope", async () => {
  const t = await scopesFor(
    "größe: German\n題名: Japanese\nautor*in: star\nautor·in: middle\n\u0308mark: no\n*star: no\n·middle: no\n",
  );
  for (const key of ["größe", "題名", "autor*in", "autor·in"]) {
    expect(has(t, key, "entity.name.tag.lima"), key).toBe(true);
  }
  for (const key of ["\u0308mark", "*star", "·middle"]) {
    expect(has(t, key, "entity.name.tag.lima"), key).toBe(false);
  }
});

test("Core 1.3: a # begins a comment at the start of a value or after whitespace", async () => {
  const t = await scopesFor(
    "color: #ff0000\nnote: text # trailing\n  # indented\n- # item\ntab:\t# after a tab\nnbsp: x\u00a0#after-nbsp\n",
  );
  for (const text of ["ff0000", " trailing", " indented", " item", " after a tab", "after-nbsp"]) {
    expect(
      t.some(([x, s]) => x.includes(text) && carries(s, "comment.line.number-sign.lima")),
      text,
    ).toBe(true);
  }
  // the whitespace before the # is not part of the comment
  expect(scopesAt(await scopesFor("note: text # c"), 10)).not.toContain(
    "comment.line.number-sign.lima",
  );
});

test("Core 1.3: a # after any other character is text", async () => {
  for (const line of [
    "link: https://example.org/x#section",
    "lang: C#",
    "tight: hello#literal",
    'quoted: "x"#y',
    "nel: foo\u0085# c",
  ]) {
    const t = await scopesFor(line);
    expect(t.some(([, s]) => carries(s, "comment")), line).toBe(false);
  }
});

test("Core 1.3: \\# stays text; a # after whitespace still begins a comment", async () => {
  const t = await scopesFor("escaped: hello\\#literal\nspaced: hello \\#literal #actual\n");
  expect(t.some(([x, s]) => x.includes("literal") && carries(s, "comment"))).toBe(false);
  expect(has(t, "#", "punctuation.definition.comment.lima")).toBe(true);
  expect(has(t, "actual", "comment.line.number-sign.lima")).toBe(true);
});

test("Core 1.3: in a flow value, a # after , or [ is text, after a space a comment", async () => {
  const text = await scopesFor("k: [a,#x]\nj: [#x]\nm: {a: x#y}\n");
  expect(text.some(([, s]) => carries(s, "comment"))).toBe(false);
  expect(has(text, "]", "punctuation.definition.sequence.end.lima")).toBe(true);
  expect(has(text, "}", "punctuation.definition.mapping.end.lima")).toBe(true);

  const sequence = await scopesFor("k: [a, #x]\nnext: 1\n");
  expect(has(sequence, "#", "punctuation.definition.comment.lima")).toBe(true);
  expect(has(sequence, "x]", "comment.line.number-sign.lima")).toBe(true);
  // the unclosed sequence ends with its line, so the next line is an entry
  expect(sequence.find(([x]) => x === "next")?.[1]).toEqual([
    "source.lima",
    "entity.name.tag.lima",
  ]);

  const mapping = await scopesFor("m: {a: x #y}\nn: {b: #z}\n");
  expect(has(mapping, "y}", "comment.line.number-sign.lima")).toBe(true);
  expect(has(mapping, "z}", "comment.line.number-sign.lima")).toBe(true);
  expect(has(mapping, "b", "entity.name.tag.lima")).toBe(true);
});

test("Core 1.3: a tab after the colon separates key and value; other whitespace does not", async () => {
  const t = await scopesFor('title:\tHello\n"quoted key":\tx\nflow: {a:\tb}\n');
  for (const key of ["title", '"quoted key"', "a"]) {
    expect(has(t, key, "entity.name.tag.lima"), key).toBe(true);
  }
  const nbsp = await scopesFor("title:\u00a0Hello\nflow: {a:b}\n");
  expect(has(nbsp, "title", "entity.name.tag.lima")).toBe(false);
  expect(has(nbsp, "a", "entity.name.tag.lima")).toBe(false);
});

test("Core 1.3: key: # note is a key with a comment, and its block follows", async () => {
  const t = await scopesFor("author: # who wrote it\n  name: Alice\nlist: # items\n- one\n");
  expect(has(t, "author", "entity.name.tag.lima")).toBe(true);
  expect(has(t, "#", "punctuation.definition.comment.lima")).toBe(true);
  expect(has(t, " who wrote it", "comment.line.number-sign.lima")).toBe(true);
  expect(has(t, "name", "entity.name.tag.lima")).toBe(true);
  expect(has(t, "list", "entity.name.tag.lima")).toBe(true);
  expect(has(t, " items", "comment.line.number-sign.lima")).toBe(true);
  expect(has(t, "-", "punctuation.definition.list.begin.lima")).toBe(true);
});

test("a # inside a quoted string stays literal; one after the closing quote and a space is a comment", async () => {
  const t = await scopesFor(
    'quoted-hash: "hello#not-a-comment"\nquoted-then-comment: "hello#literal" #outer\n',
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

test("a string ends with its line when it does not close", async () => {
  const t = await scopesFor('a: "open\nb: [\'x, y\nc: 1\n');
  expect(has(t, "b", "entity.name.tag.lima")).toBe(true);
  expect(has(t, "c", "entity.name.tag.lima")).toBe(true);
  expect(has(t, "1", "constant.numeric.lima")).toBe(true);
});

test("keys of object items, and their block scalars, are highlighted", async () => {
  const t = await scopesFor("items:\n  - name: Alice\n    body: |\n      text\n  - | \n");
  expect(has(t, "name", "entity.name.tag.lima")).toBe(true);
  expect(has(t, "body", "entity.name.tag.lima")).toBe(true);
  expect(
    t.filter(([x, s]) => x === "|" && carries(s, "keyword.operator.block-scalar.lima")),
  ).toHaveLength(2);
  expect(
    t.filter(([x, s]) => x === "-" && carries(s, "punctuation.definition.list.begin.lima")),
  ).toHaveLength(2);
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

test("References 2.1: Unicode ${document} and $(partial) tokens are references", async () => {
  const t = await scopesFor(
    "a: ${title}\nb: Hello ${first.name}!\nc: $(author.name)\nd: $(persons/alice.city)\ne: ${größe}\nf: ${autor*in}\ng: $(personen/zoë.name)\n",
  );
  expect(has(t, "${title}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "${first.name}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "$(author.name)", "variable.other.reference.partial.lima")).toBe(true);
  expect(has(t, "$(persons/alice.city)", "variable.other.reference.partial.lima")).toBe(true);
  expect(has(t, "${größe}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "${autor*in}", "variable.other.reference.document.lima")).toBe(true);
  expect(has(t, "$(personen/zoë.name)", "variable.other.reference.partial.lima")).toBe(true);
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
  const t = await scopesFor("one: |\ntwo:  |\nfour:    |\ntab:\t |\ntrailing: |\u00a0\n");
  expect(
    t.filter(
      ([text, scopes]) =>
        text === "|" &&
        scopes.some((scope) => scope.includes("keyword.operator.block-scalar.lima")),
    ),
  ).toHaveLength(5);
  const folded = await scopesFor("text: >\n  body line\n");
  expect(has(folded, ">", "keyword.operator.block-scalar.lima")).toBe(false);
});

test("Core 1.3 §6.1.5: key: | # note is the string |, followed by a comment", async () => {
  const t = await scopesFor("body: | # note\nmore: |x\n");
  expect(has(t, "|", "keyword.operator.block-scalar.lima")).toBe(false);
  expect(has(t, " note", "comment.line.number-sign.lima")).toBe(true);
});

test("scalars match whole words only", async () => {
  for (const line of [
    "a: non-null",
    "b: true-ish",
    "c: version 1.2.3",
    "d: pages 10-20",
    "e: x~",
    "f: v1",
  ]) {
    const t = await scopesFor(line);
    expect(t.some(([, s]) => carries(s, "constant")), line).toBe(false);
  }
  const flow = await scopesFor("g: [10,20]\nh: [-5,-6]\n");
  for (const number of ["10", "20", "-5", "-6"]) {
    expect(has(flow, number, "constant.numeric.lima"), number).toBe(true);
  }
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

test("Markdown front matter reads Core 1.3 as a .lima file does", async () => {
  // Without VS Code's Markdown grammar, the injection grammar stands alone:
  // its rule for the front matter block is what VS Code injects.
  const t = await scopesFor(
    "---\nlink: https://example.org/x#top\nauthor: # who\n  name: Alice\ntitle:\tHello\n---\nnot: front matter\n",
    "lima.frontmatter.injection",
  );
  expect(t.some(([x, s]) => x.includes("top") && carries(s, "comment"))).toBe(false);
  expect(has(t, " who", "comment.line.number-sign.lima")).toBe(true);
  for (const key of ["link", "author", "name", "title"]) {
    expect(has(t, key, "entity.name.tag.lima"), key).toBe(true);
  }
  expect(has(t, "not", "entity.name.tag.lima")).toBe(false);
});
