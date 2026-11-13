/** Tests the shared diagnostic layer against the real Lima parser. */

import { expect, test } from "bun:test";
import { check } from "./diagnostics.js";

test("a clean document produces no findings", () => {
  expect(check("title: Hello\ntags: [a, b]\n")).toEqual([]);
});

test("invalid flow syntax is an error with a position", () => {
  const f = check("tags: [1, [2]]\n"); // nested flow sequence — invalid in Core
  expect(f.length).toBeGreaterThan(0);
  expect(f[0].severity).toBe("error");
  expect(f[0].code).toBe("INVALID_FLOW_SYNTAX");
  expect(f[0].line).toBe(1);
  expect(f[0].message.startsWith("Lima:")).toBe(false); // prefix stripped
});

test("strict mode reports duplicate keys, non-strict warns", () => {
  const strict = check("a: 1\na: 2\n"); // strict defaults on
  expect(strict.find((d) => d.code === "DUPLICATE_KEY")?.severity).toBe("error");

  const lenient = check("a: 1\na: 2\n", { strict: false });
  expect(lenient.find((d) => d.code === "DUPLICATE_KEY")?.severity).toBe("warning");
});

test("strict mode catches invalid dates, escapes, unterminated strings", () => {
  expect(check("d: 2024-13-99\n").some((f) => f.code === "INVALID_DATE")).toBe(true);
  expect(check('s: "bad \\q"\n').some((f) => f.code === "INVALID_ESCAPE")).toBe(true);
  expect(check('q: "open\n').some((f) => f.code === "INVALID_QUOTE")).toBe(true);
});

test("Core 1.2 diagnostics include unrecognised-line hints and invalid documents", () => {
  const unrecognised = check("title: ok\nmissing separator\n");
  expect(unrecognised).toMatchObject([
    {
      code: "UNRECOGNIZED_LINE",
      severity: "error",
      message: expect.stringContaining('a key needs ": " after it'),
    },
  ]);
  expect(check("title: \ud800\n")).toMatchObject([
    { code: "INVALID_DOCUMENT", severity: "error", line: 1 },
  ]);
});

test("an apostrophe in an unquoted value is not a diagnostic", () => {
  expect(check("tagline: leaving out much of YAML's broader grammar.\n")).toEqual([]);
});

test("unresolved references are suppressed by default, surfaced when asked", () => {
  const doc = "a: 1\nb: ${nope}\n";
  expect(check(doc)).toEqual([]); // ignoreUnresolvedReferences defaults true
  const shown = check(doc, { ignoreUnresolvedReferences: false });
  expect(shown.some((d) => d.code === "UNRESOLVED_REFERENCE")).toBe(true);
});

test("Core 1.3: YAML node properties and block scalar headers name their cure", () => {
  expect(check("note: *new*\n")).toMatchObject([
    {
      code: "UNSUPPORTED_YAML",
      severity: "error",
      line: 1,
      message: expect.stringContaining("YAML reads it as an alias"),
    },
  ]);
  expect(check("list:\n  - &anchor x\n")).toMatchObject([
    { code: "UNSUPPORTED_YAML", line: 2, message: expect.stringContaining("quote the value") },
  ]);
  // the header's own line, not its first indented line
  expect(check("body: >\n  folded\n")).toMatchObject([
    { code: "UNSUPPORTED_YAML", line: 1, message: expect.stringContaining('Lima writes "|"') },
  ]);
  // non-strict mode reads them as strings
  expect(check("note: *new*\nbody: >\n", { strict: false })).toEqual([]);
});

test("Core 1.3: what Core 1.3 reads otherwise is no finding", () => {
  expect(check("link: https://example.org/x#top\ntags: [a,#x]\n")).toEqual([]);
  expect(check("title:\tHello\n")).toEqual([]);
  expect(check("author: # who wrote it\n  name: Alice\n")).toEqual([]);
  expect(check("m: {k: }\n")).toEqual([]);
  expect(check("tags: [a, #x]\n")).toMatchObject([
    { code: "INVALID_FLOW_SYNTAX", line: 1, message: expect.stringContaining("unclosed flow sequence") },
  ]);
});
