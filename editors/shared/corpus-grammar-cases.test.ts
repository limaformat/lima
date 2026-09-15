import { expect, test } from "bun:test";
import { CORPUS_GRAMMAR_CASES } from "./corpus-grammar-cases.js";

test("loads one-line comment and quoted conformance cases", () => {
  expect(CORPUS_GRAMMAR_CASES.length).toBeGreaterThan(0);
  expect(CORPUS_GRAMMAR_CASES.every(({ input }) => !input.includes("\n"))).toBe(
    true,
  );
  expect(
    CORPUS_GRAMMAR_CASES.find(
      ({ id }) => id === "core.document.inline-pipeline.comment-stripped",
    )?.commentStart,
  ).toBe("title: Hello World # comment".indexOf("#"));
  expect(
    CORPUS_GRAMMAR_CASES.find(
      ({ id }) => id === "core.document.inline-pipeline.hash-in-quotes-literal",
    ),
  ).toMatchObject({
    commentStart: null,
    quoteRanges: [
      { range: [6, 40], quote: "double", kind: "string", closed: true },
    ],
  });
});
