import { expect, test } from "bun:test";
import type { LimaFinding } from "./diagnostics.js";
import { findingRange } from "./finding-range.js";

function finding(overrides: Partial<LimaFinding> = {}): LimaFinding {
  return {
    severity: "error",
    line: 2,
    column: 3,
    code: "TEST",
    message: "test finding",
    ...overrides,
  };
}

test("maps one-based findings and a line offset to a zero-based range", () => {
  const range = findingRange(finding({ length: 4 }), 1, (line) => {
    expect(line).toBe(2);
    return "x".repeat(10);
  });
  expect(range).toEqual({
    start: { line: 2, character: 2 },
    end: { line: 2, character: 6 },
  });
});

test("uses the rest of the line when a finding has no token length", () => {
  expect(findingRange(finding(), 0, () => "x".repeat(10))).toEqual({
    start: { line: 1, character: 2 },
    end: { line: 1, character: 10 },
  });
});

test("clamps columns to the supplied line length", () => {
  expect(
    findingRange(finding({ column: 20, length: 5 }), 0, () => "xxxx"),
  ).toEqual({
    start: { line: 1, character: 4 },
    end: { line: 1, character: 4 },
  });
});

test("converts codepoint columns to UTF-16 around astral characters", () => {
  const text = 'greeting: "🚀🚀" # bad';
  expect(
    findingRange(finding({ line: 1, column: 16, length: 1 }), 0, () => text),
  ).toEqual({
    start: { line: 0, character: 17 },
    end: { line: 0, character: 18 },
  });
});
