/**
 * Tests the pure diagnostic layer (src/diagnostics.ts + src/frontmatter.ts)
 * against the real bundled parser. No `vscode` dependency.
 *
 *   bun test
 */

import { expect, test } from "bun:test";
import { check } from "../src/diagnostics.js";
import { extractFrontmatter } from "../src/frontmatter.js";

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

test("an apostrophe in an unquoted value is not a diagnostic", () => {
  expect(check("tagline: leaving out much of YAML's broader grammar.\n")).toEqual([]);
});

test("unresolved references are suppressed by default, surfaced when asked", () => {
  const doc = "a: 1\nb: ${nope}\n";
  expect(check(doc)).toEqual([]); // ignoreUnresolvedReferences defaults true
  const shown = check(doc, { ignoreUnresolvedReferences: false });
  expect(shown.some((d) => d.code === "UNRESOLVED_REFERENCE")).toBe(true);
});

test("extractFrontmatter pulls the leading --- block", () => {
  const md = "---\ntitle: Hi\ndraft: true\n---\n\n# Body\n";
  const fm = extractFrontmatter(md);
  expect(fm).not.toBeNull();
  expect(fm!.text).toBe("title: Hi\ndraft: true\n");
  expect(fm!.startLine).toBe(1);
});

test("extractFrontmatter returns null without a leading fence", () => {
  expect(extractFrontmatter("# Just a heading\n\n---\n")).toBeNull();
  expect(extractFrontmatter("\n---\ntitle: x\n---\n")).toBeNull();
});

test("a frontmatter error is found in the extracted text, with the right line", () => {
  const md = "---\ntitle: ok\nwhen: 2024-13-99\n---\n# body\n";
  const fm = extractFrontmatter(md);
  const f = check(fm!.text);
  expect(f.some((d) => d.severity === "error")).toBe(true);
  // "when:" is line 2 within the body; the extension adds fm.startLine (1)
  // to land it on document line 3.
  expect(f[0].line).toBe(2);
});
