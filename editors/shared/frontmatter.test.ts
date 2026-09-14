/** Tests shared Markdown / MDX frontmatter extraction. */

import { expect, test } from "bun:test";
import { check } from "./diagnostics.js";
import { extractFrontmatter } from "./frontmatter.js";

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
  // "when:" is line 2 within the body; integrations add fm.startLine (1)
  // to land it on document line 3.
  expect(f[0].line).toBe(2);
});
