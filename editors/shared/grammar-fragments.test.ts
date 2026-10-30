import { expect, test } from "bun:test";
import {
  BLOCK_SCALAR,
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
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("site-name:en_1")).toBe(true);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("größe")).toBe(true);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("題名")).toBe(true);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("autor*in")).toBe(true);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("autor·in")).toBe(true);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("\u0308mark")).toBe(false);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("*name")).toBe(false);
  expect(new RegExp(`^(?:${UNQUOTED_KEY})$`, "u").test("·name")).toBe(false);
  expect(new RegExp(`^(?:${DOUBLE_QUOTED_KEY})$`).test('"say \\"hi\\""')).toBe(
    true,
  );
  expect(new RegExp(`^(?:${KEY})$`, "u").test("not a key")).toBe(false);
  expect(new RegExp(`^(?:${DOCUMENT_REFERENCE})$`, "u").test("${site.title}")).toBe(
    true,
  );
  expect(new RegExp(`^(?:${DOCUMENT_REFERENCE})$`, "u").test("${größe}")).toBe(true);
  expect(new RegExp(`^(?:${DOCUMENT_REFERENCE})$`, "u").test("${autor*in}")).toBe(true);
  expect(new RegExp(`^(?:${PARTIAL_REFERENCE})$`, "u").test("$(people/alice.name)")).toBe(
    true,
  );
  expect(new RegExp(`^(?:${PARTIAL_REFERENCE})$`, "u").test("$(personen/zoë.name)")).toBe(true);
  expect(new RegExp(COMMENT).exec("value#comment")?.index).toBe(5);
  expect(new RegExp(COMMENT).test(String.raw`value\#literal`)).toBe(false);
  expect(new RegExp(BLOCK_SCALAR).exec("query:    |")?.[2]).toBe("|");
});

test("the supported Oniguruma subset renders to Emacs syntax", () => {
  expect(onigurumaFragmentToEmacs("a(?:b|c)*")).toBe(String.raw`a\(?:b\|c\)*`);
  expect(EMACS_KEY).toContain(String.raw`\(?:\\.\|[^"\\]\)*`);
  expect(EMACS_KEY).toContain("[:alnum:]");
});
