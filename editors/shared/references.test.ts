import { expect, test } from "bun:test";
import { parse } from "../../js/src/references2.js";
import { ReferenceResolver, referenceAtPosition } from "./references.js";

const DOCUMENT = [
  "title: Hello",
  "site:",
  "  default:",
  "    claim: Software, Tools, AI",
  "summary: ${title} / ${site.default.claim}",
  "missing: ${nonexistent}",
  "author: $(people/alice.name)",
  "quoted: \"${title}\" # ${title}",
  "emoji: 😀 ${title}",
  "",
].join("\n");

test("finds and resolves an active document reference", () => {
  const reference = referenceAtPosition(DOCUMENT, { line: 4, character: 12 });
  expect(reference).toMatchObject({
    kind: "document",
    path: "title",
    token: "${title}",
    range: {
      start: { line: 4, character: 9 },
      end: { line: 4, character: 17 },
    },
    definition: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  });
  expect(reference?.hover).toContain("defined on line 1");
});

test("resolves a dotted document path to its nested value line", () => {
  const reference = referenceAtPosition(DOCUMENT, { line: 4, character: 25 });
  expect(reference).toMatchObject({
    kind: "document",
    path: "site.default.claim",
    definition: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
    },
  });
});

test("locates a reference at its real position inside a nested block mapping", () => {
  const text = [
    "title: Hello",
    "site:",
    "  default:",
    "    claim: ${title}",
    "",
  ].join("\n");

  expect(referenceAtPosition(text, { line: 0, character: 7 })).toBeNull();
  expect(
    referenceAtPosition(text, { line: 3, character: 14 }),
  ).toMatchObject({
    path: "title",
    range: {
      start: { line: 3, character: 11 },
      end: { line: 3, character: 19 },
    },
    definition: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  });
});

test("describes an unresolved document reference without a definition", () => {
  const reference = referenceAtPosition(DOCUMENT, { line: 5, character: 12 });
  expect(reference).toMatchObject({
    kind: "document",
    path: "nonexistent",
  });
  expect(reference?.definition).toBeUndefined();
  expect(reference?.hover).toContain("No matching resolvable document path");
});

test("explains partial references but never gives them a definition", () => {
  const reference = referenceAtPosition(DOCUMENT, { line: 6, character: 14 });
  expect(reference).toMatchObject({
    kind: "partial",
    path: "people/alice.name",
  });
  expect(reference?.definition).toBeUndefined();
  expect(reference?.hover).toContain("supplied by the caller");
});

test("ignores quoted and commented reference-shaped text", () => {
  expect(referenceAtPosition(DOCUMENT, { line: 7, character: 10 })).toBeNull();
  expect(referenceAtPosition(DOCUMENT, { line: 7, character: 24 })).toBeNull();
});

test("converts the scanner's codepoint column to a UTF-16 editor position", () => {
  const reference = referenceAtPosition(DOCUMENT, { line: 8, character: 12 });
  expect(reference?.range).toEqual({
    start: { line: 8, character: 10 },
    end: { line: 8, character: 18 },
  });
});

test("offsets token and definition lines for an extracted frontmatter body", () => {
  const body = "title: Hello\nsummary: ${title}\n";
  const reference = referenceAtPosition(
    body,
    { line: 2, character: 12 },
    { lineOffset: 1 },
  );
  expect(reference).toMatchObject({
    range: {
      start: { line: 2, character: 9 },
      end: { line: 2, character: 17 },
    },
    definition: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    },
  });
});

test("uses the configured strict mode when duplicate keys invalidate a document", () => {
  const text = "title: first\ntitle: second\nref: ${title}\n";

  const strictReference = referenceAtPosition(text, {
    line: 2,
    character: 8,
  });
  expect(strictReference?.definition).toBeUndefined();
  expect(strictReference?.hover).toContain("configured strict mode");
  expect(
    referenceAtPosition(
      text,
      { line: 2, character: 8 },
      { strict: false },
    )?.definition,
  ).toEqual({
    start: { line: 1, character: 0 },
    end: { line: 1, character: 0 },
  });
});

test("matches the real resolver for a two-alias path", () => {
  const text = [
    "c:",
    "  x: 5",
    "b: ${c}",
    "a: ${b}",
    "ref: ${a.x}",
    "",
  ].join("\n");

  expect(parse(text).ref).toBe(5);
  expect(
    referenceAtPosition(text, { line: 4, character: 9 })?.definition,
  ).toEqual({
    start: { line: 1, character: 0 },
    end: { line: 1, character: 0 },
  });
});

test("matches the real resolver's unresolved result past the edge limit", () => {
  const text = [
    "d:",
    "  x: 5",
    "c: ${d}",
    "b: ${c}",
    "a: ${b}",
    "ref: ${a.x}",
    "",
  ].join("\n");

  expect(parse(text).ref).toBe("${a.x}");
  const reference = referenceAtPosition(text, { line: 5, character: 9 });
  expect(reference?.definition).toBeUndefined();
  expect(reference?.hover).toContain("No matching resolvable document path");
});

test("locates a reference in an earlier shadowed duplicate value", () => {
  const text = [
    "title: destination",
    "shadow: ${title}",
    "shadow: replacement",
    "",
  ].join("\n");

  const strictReference = referenceAtPosition(text, {
    line: 1,
    character: 12,
  });
  expect(strictReference?.definition).toBeUndefined();
  expect(strictReference?.hover).toContain("configured strict mode");

  const reference = referenceAtPosition(
    text,
    { line: 1, character: 12 },
    { strict: false },
  );
  expect(reference).toMatchObject({
    path: "title",
    range: {
      start: { line: 1, character: 8 },
      end: { line: 1, character: 16 },
    },
    definition: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  });
});

test("the document cache invalidates on version and strictness", () => {
  const resolver = new ReferenceResolver();
  let text = "title: first\nref: ${title}\n";
  const document = {
    uri: "file:///cache.lima",
    languageId: "lima",
    version: 1,
    getText: () => text,
  };

  expect(
    resolver.referenceAt(document, { line: 1, character: 8 })?.definition,
  ).toEqual({
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  });

  text = "other: value\ntitle: second\nref: ${title}\n";
  document.version = 2;
  expect(
    resolver.referenceAt(document, { line: 2, character: 8 })?.definition,
  ).toEqual({
    start: { line: 1, character: 0 },
    end: { line: 1, character: 0 },
  });

  text = "title: first\ntitle: second\nref: ${title}\n";
  document.version = 3;
  expect(
    resolver.referenceAt(document, { line: 2, character: 8 }, true)?.definition,
  ).toBeUndefined();
  expect(
    resolver.referenceAt(document, { line: 2, character: 8 }, false),
  ).not.toBeNull();
});
