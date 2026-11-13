import { expect, test } from "bun:test";
import { isTrimWhitespace } from "../../js/src/chars.js";
import {
  ARRAY_DASH,
  COMMENT,
  DOCUMENT_REFERENCE,
  DOUBLE_QUOTED_KEY,
  EMACS_KEY,
  EMACS_WHITESPACE,
  FLOW_MAPPING_KEY,
  KEY,
  MAPPING_KEY,
  PARTIAL_REFERENCE,
  UNQUOTED_KEY,
  WHITESPACE,
  fragmentToJavaScript,
  onigurumaFragmentToEmacs,
} from "./grammar-fragments.js";

const regExp = (fragment: string): RegExp =>
  new RegExp(fragmentToJavaScript(fragment), "u");
const whole = (fragment: string): RegExp => regExp(`^(?:${fragment})$`);

test("canonical grammar fragments cover keys and references", () => {
  expect(whole(UNQUOTED_KEY).test("site-name:en_1")).toBe(true);
  expect(whole(UNQUOTED_KEY).test("größe")).toBe(true);
  expect(whole(UNQUOTED_KEY).test("題名")).toBe(true);
  expect(whole(UNQUOTED_KEY).test("autor*in")).toBe(true);
  expect(whole(UNQUOTED_KEY).test("autor·in")).toBe(true);
  expect(whole(UNQUOTED_KEY).test("\u0308mark")).toBe(false);
  expect(whole(UNQUOTED_KEY).test("*name")).toBe(false);
  expect(whole(UNQUOTED_KEY).test("·name")).toBe(false);
  expect(whole(DOUBLE_QUOTED_KEY).test('"say \\"hi\\""')).toBe(true);
  expect(whole(KEY).test("not a key")).toBe(false);
  expect(whole(DOCUMENT_REFERENCE).test("${site.title}")).toBe(true);
  expect(whole(DOCUMENT_REFERENCE).test("${größe}")).toBe(true);
  expect(whole(DOCUMENT_REFERENCE).test("${autor*in}")).toBe(true);
  expect(whole(PARTIAL_REFERENCE).test("$(people/alice.name)")).toBe(true);
  expect(whole(PARTIAL_REFERENCE).test("$(personen/zoë.name)")).toBe(true);
});

test("WHITESPACE is Core 1.3 §1 whitespace, the parser's own set", () => {
  const whitespace = regExp(`^${WHITESPACE}$`);
  const emacs = new RegExp(`^${EMACS_WHITESPACE}$`, "u");
  for (let unit = 0; unit <= 0xffff; unit++) {
    if (unit >= 0xd800 && unit <= 0xdfff) continue;
    const character = String.fromCharCode(unit);
    expect(whitespace.test(character), unit.toString(16)).toBe(isTrimWhitespace(unit));
    expect(emacs.test(character), unit.toString(16)).toBe(isTrimWhitespace(unit));
  }
});

test("Core 1.3: a # begins a comment at the start of a line or after whitespace", () => {
  const comment = (line: string) => regExp(COMMENT).exec(line)?.[1] ?? null;
  expect(comment("# note")).toBe("# note");
  expect(comment("  # note")).toBe("# note");
  expect(comment("value # note")).toBe("# note");
  expect(comment("value\u00a0#note")).toBe("#note");
  expect(comment("value#text")).toBeNull();
  expect(comment(String.raw`value \#text`)).toBeNull();
  expect(comment("[a,#x]")).toBeNull();
  expect(comment("[a, #x]")).toBe("#x]");
  expect(comment("foo\u0085# c")).toBeNull();
});

test("Core 1.3: entries take a space or a tab after the colon, and may hold a comment", () => {
  const entry = (line: string) => regExp(MAPPING_KEY).exec(line);
  expect(entry("title: Hello")?.[2]).toBe("title");
  expect(entry("title:\tHello")?.[2]).toBe("title");
  expect(entry("title:")?.[2]).toBe("title");
  expect(entry("title:\u00a0Hello")).toBeNull();
  expect(entry("title:Hello")).toBeNull();
  expect(entry("og:title: Hello")?.[2]).toBe("og:title");
  expect(entry("  - name: Alice")?.slice(1, 3)).toEqual(["-", "name"]);
  expect(entry("author: # who")?.[5]).toBe("# who");
  expect(entry("author:\t# who")?.[5]).toBe("# who");
  expect(entry("body: |")?.[4]).toBe("|");
  expect(entry("body: |\u00a0")?.[4]).toBe("|");
  expect(entry("body: | # note")?.[4]).toBeUndefined();
  expect(entry("body: |x")?.[4]).toBeUndefined();

  const item = (line: string) => regExp(ARRAY_DASH).exec(line);
  expect(item("- one")?.[1]).toBe("-");
  expect(item("-")?.[1]).toBe("-");
  expect(item("- # note")?.[3]).toBe("# note");
  expect(item("- |")?.[2]).toBe("|");
  expect(item("-x")).toBeNull();
  expect(item("---")).toBeNull();

  const flow = (text: string) => regExp(FLOW_MAPPING_KEY).exec(text);
  expect(flow("a: 1}")?.[1]).toBe("a");
  expect(flow("a:\t1}")?.[1]).toBe("a");
  expect(flow("a:}")).toBeNull();
  expect(flow("a: #x}")?.[3]).toBe("#x}");
});

test("the supported Oniguruma subset renders to Emacs syntax", () => {
  expect(onigurumaFragmentToEmacs("a(?:b|c)*")).toBe(String.raw`a\(?:b\|c\)*`);
  expect(EMACS_KEY).toContain(String.raw`\(?:\\.\|[^"\\]\)*`);
  expect(EMACS_KEY).toContain("[:alnum:]");
  // U+00B7 itself, not the six characters of its escape
  expect(EMACS_KEY).toContain("_:*\u00b7-]");
});
