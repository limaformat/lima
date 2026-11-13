import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { outline } from "../../js/src/index.js";
import {
  SemanticTokenCache,
  documentSemanticTokens,
  outlineTokens,
  type SemanticToken,
} from "./semantic-tokens.js";

const CORPUS = resolve(__dirname, "../..", "corpus");

/** Every corpus input written in its case; generated inputs are left out. */
function corpusInputs(): { id: string; input: string }[] {
  return readdirSync(CORPUS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name }) =>
      readdirSync(resolve(CORPUS, name))
        .filter((file) => file.endsWith(".json"))
        .map((file) => JSON.parse(readFileSync(resolve(CORPUS, name, file), "utf8"))),
    )
    .filter((fixture): fixture is { id: string; input: string } => typeof fixture.input === "string");
}

const key = (token: SemanticToken) => `${token.line}:${token.character}:${token.length}:${token.type}`;

test("every key and comment span of outline() is a token, and none overlaps", () => {
  const cases = corpusInputs();
  expect(cases.length).toBeGreaterThan(500);
  let spans = 0;
  for (const { id, input } of cases) {
    const limaOutline = outline(input);
    const tokens = outlineTokens(limaOutline);
    // outline() counts from the input without its byte order mark
    const source = input.replace(/^\uFEFF/, "");
    const lines = source.split(/\r\n|\r|\n/);
    const expected = [
      ...limaOutline.keys.map(({ span }) => ({ span, type: "property" as const })),
      ...limaOutline.comments.map((span) => ({ span, type: "comment" as const })),
    ];
    spans += expected.length;
    expect(tokens.length, id).toBe(expected.length);
    const found = new Set(tokens.map(key));
    for (const { span, type } of expected) {
      const token: SemanticToken = {
        line: span.start.line - 1,
        character: span.start.column - 1,
        length: span.end.offset - span.start.offset,
        type,
      };
      expect(found.has(key(token)), `${id}: ${type} at ${JSON.stringify(span.start)}`).toBe(true);
      // the token covers the span's text on its line
      expect(
        lines[token.line].slice(token.character, token.character + token.length),
        id,
      ).toBe(source.slice(span.start.offset, span.end.offset));
    }
    for (let index = 1; index < tokens.length; index++) {
      const [previous, next] = [tokens[index - 1], tokens[index]];
      const ordered =
        previous.line < next.line ||
        (previous.line === next.line && previous.character + previous.length <= next.character);
      expect(ordered, `${id}: ${key(previous)} before ${key(next)}`).toBe(true);
    }
  }
  expect(spans).toBeGreaterThan(1000);
});

test("tokens of a key and a comment, in UTF-16 code units", () => {
  expect(documentSemanticTokens("lima", "größe: 1 # 😀 note\n𝒳: 2\n")).toEqual([
    { line: 0, character: 0, length: 5, type: "property" },
    { line: 0, character: 9, length: 9, type: "comment" },
    { line: 1, character: 0, length: 2, type: "property" },
  ]);
  // Core 1.3: a comment after the separator leaves the key bare; its block follows
  expect(documentSemanticTokens("lima", "author: # who\n  name: Alice\nlink: x#top\n")).toEqual([
    { line: 0, character: 0, length: 6, type: "property" },
    { line: 0, character: 8, length: 5, type: "comment" },
    { line: 1, character: 2, length: 4, type: "property" },
    { line: 2, character: 0, length: 4, type: "property" },
  ]);
  // a # line inside a block scalar is content, not a comment
  expect(documentSemanticTokens("lima", "body: |\n  # text\n# note\n")).toEqual([
    { line: 0, character: 0, length: 4, type: "property" },
    { line: 2, character: 0, length: 6, type: "comment" },
  ]);
});

test("front matter tokens count from the start of the Markdown document", () => {
  const markdown = "---\r\ntitle: Hello # greeting\r\n---\r\n# Heading\r\n";
  expect(documentSemanticTokens("markdown", markdown)).toEqual([
    { line: 1, character: 0, length: 5, type: "property" },
    { line: 1, character: 13, length: 10, type: "comment" },
  ]);
  expect(documentSemanticTokens("mdx", "# no front matter\n")).toEqual([]);
  expect(documentSemanticTokens("plaintext", "title: Hello\n")).toEqual([]);
});

test("a byte order mark shifts the first line's tokens", () => {
  expect(documentSemanticTokens("lima", "\uFEFFa: 1 # c\nb: 2\n")).toEqual([
    { line: 0, character: 1, length: 1, type: "property" },
    { line: 0, character: 6, length: 3, type: "comment" },
    { line: 1, character: 0, length: 1, type: "property" },
  ]);
});

test("a document over a resource limit has no tokens", () => {
  const keys = Array.from({ length: 129 }, (_, index) => `k${index}: v`).join("\n");
  expect(documentSemanticTokens("lima", keys)).toEqual([]);
});

test("the cache reads a document once per version", () => {
  const cache = new SemanticTokenCache();
  let reads = 0;
  const text = () => {
    reads++;
    return reads === 1 ? "a: 1\n" : "a: 1\nb: 2\n";
  };
  expect(cache.tokens("file:///a.lima", 1, "lima", text)).toHaveLength(1);
  expect(cache.tokens("file:///a.lima", 1, "lima", text)).toHaveLength(1);
  expect(reads).toBe(1);
  expect(cache.tokens("file:///a.lima", 2, "lima", text)).toHaveLength(2);
  expect(reads).toBe(2);
  cache.delete("file:///a.lima");
  cache.tokens("file:///a.lima", 2, "lima", text);
  expect(reads).toBe(3);
});
