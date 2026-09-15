import { expect, test } from "bun:test";
import {
  COMMENT,
  DOCUMENT_REFERENCE,
  DOUBLE_QUOTED_KEY,
  EMACS_KEY,
  KEY,
  PARTIAL_REFERENCE,
  UNQUOTED_KEY,
  onigurumaFragmentToEmacs,
} from "./grammar-fragments.js";

test("canonical grammar fragments cover keys, references, and comments", () => {
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`).test("site-name:en_1")).toBe(true);
  expect(new RegExp(`^(?:${DOUBLE_QUOTED_KEY})$`).test('"say \\"hi\\""')).toBe(
    true,
  );
  expect(new RegExp(`^(?:${KEY})$`).test("not a key")).toBe(false);
  expect(new RegExp(`^(?:${DOCUMENT_REFERENCE})$`).test("${site.title}")).toBe(
    true,
  );
  expect(new RegExp(`^(?:${PARTIAL_REFERENCE})$`).test("$(people/alice.name)")).toBe(
    true,
  );
  expect(new RegExp(COMMENT).exec("value#comment")?.index).toBe(5);
  expect(new RegExp(COMMENT).test(String.raw`value\#literal`)).toBe(false);
});

test("the supported Oniguruma subset renders to Emacs syntax", () => {
  expect(onigurumaFragmentToEmacs("a(?:b|c)*")).toBe(String.raw`a\(?:b\|c\)*`);
  expect(EMACS_KEY).toContain(String.raw`\(?:\\.\|[^"\\]\)*`);
});
