/**
 * Patterns the TextMate, Sublime and Emacs grammars share; scripts/
 * generate-grammar-fragments.ts writes them into each grammar.
 *
 * Every TextMate and Sublime pattern is written in RE2 syntax, which the
 * editors' Oniguruma reads alike: no lookaround, no backreference, no atomic
 * group and no possessive quantifier (re2-syntax.test.ts checks every one).
 * A code point is written `\x{…}`, which both read. Where a rule once looked
 * around a token, it now consumes what it looked at, in a group apart from
 * the token's scope, or tests a word boundary (`\b`, `\B`).
 */

/**
 * Core 1.2 §5.1 and References 2.1 path segments. Oniguruma supports Unicode
 * general-category properties; the implementation itself uses the fixed
 * Unicode 18.0 table in js/src/unicode-key-table.ts.
 */
const KEY_INITIAL = String.raw`[\p{L}\p{N}_]`;
const KEY_CHARACTER = String.raw`[\p{L}\p{M}\p{N}_:*\x{00B7}-]`;
export const UNQUOTED_KEY = `${KEY_INITIAL}${KEY_CHARACTER}*`;
const DOC_PATH = `${UNQUOTED_KEY}(?:\\.${UNQUOTED_KEY})*`;
const PARTIAL_NAME = `${KEY_INITIAL}[\\p{L}\\p{M}\\p{N}_:*/\\x{00B7}-]*`;
const PARTIAL_PATH = `${PARTIAL_NAME}(?:\\.${UNQUOTED_KEY})*`;

/** Contents of a Core §5.2 double-quoted key, excluding its delimiters. */
export const DOUBLE_QUOTED_KEY_BODY = String.raw`(?:\\.|[^"\\])*`;

export const SINGLE_QUOTED_KEY = String.raw`'[^']*'`;
export const DOUBLE_QUOTED_KEY = `"${DOUBLE_QUOTED_KEY_BODY}"`;
export const KEY = `${UNQUOTED_KEY}|${SINGLE_QUOTED_KEY}|${DOUBLE_QUOTED_KEY}`;

export const DOCUMENT_REFERENCE = String.raw`\$\{${DOC_PATH}\}`;
export const PARTIAL_REFERENCE = String.raw`\$\(${PARTIAL_PATH}\)`;

/** Core 1.3 §1 whitespace, ECMAScript's WhiteSpace and LineTerminator. */
const WHITESPACE_RANGES: readonly (readonly [number, number])[] = [
  [0x0009, 0x000d],
  [0x0020, 0x0020],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

const codePoint = (value: number): string =>
  `\\x{${value.toString(16).toUpperCase().padStart(4, "0")}}`;

export const WHITESPACE = `[${WHITESPACE_RANGES.map(([first, last]) =>
  first === last ? codePoint(first) : `${codePoint(first)}-${codePoint(last)}`,
).join("")}]`;

/** A comment to the end of its line: group 1 is the comment, group 2 its `#`. */
const COMMENT_BODY = "((#).*)";

/**
 * Core 1.3 §4 and §8: outside quotes, a `#` begins a comment at the start of
 * a line or after whitespace; any other `#` is text, so is `\#`. The
 * whitespace before it is matched, outside the comment's groups. A rule that
 * consumes the whitespace after a separator or a dash looks for a comment
 * itself (VALUE_START), since none is left before the `#`.
 */
export const COMMENT = `(?:^|${WHITESPACE})${COMMENT_BODY}`;

/**
 * What may start a value right after the whitespace of its separator or dash:
 * `|` alone, a literal block scalar (Core 1.3 §6.1.5, decided before comment
 * removal, so `key: | # note` is the string `|`), or a comment, which leaves
 * the key bare (§4). Groups: 1 is the `|`, 2 and 3 the comment.
 */
const VALUE_START = `(?:(\\|)${WHITESPACE}*$|${COMMENT_BODY})?`;

/**
 * An entry at the start of a line (Core 1.3 §4, §5), after the dash of an
 * object item (§7.2) too: its key and its separator, a colon followed by a
 * space, a tab (§5.1) or the end of the line. A colon followed by other
 * whitespace, such as U+00A0, is no separator. Groups: 1 the dash, 2 the key,
 * 3 the colon, 4 a `|`, 5 and 6 a comment.
 */
export const MAPPING_KEY = `^[ \\t]*(?:(-)${WHITESPACE}+)?(${KEY})[ \\t]*(:)(?:$|[ \\t]${WHITESPACE}*${VALUE_START})`;

/**
 * A sequence item's dash, alone or followed by whitespace (Core 1.3 §7.2).
 * Groups: 1 the dash, 2 a `|`, 3 and 4 a comment.
 */
export const ARRAY_DASH = `^[ \\t]*(-)(?:$|${WHITESPACE}+${VALUE_START})`;

/**
 * A flow mapping's key and separator, a colon followed by a space or a tab
 * (Core 1.3 §7.5): `{k:}` has none. Groups: 1 the key, 2 the colon, 3 and 4 a
 * comment, which leaves the mapping unclosed.
 */
export const FLOW_MAPPING_KEY = `(${KEY})[ \\t]*(:)[ \\t]${WHITESPACE}*${COMMENT_BODY}?`;

/**
 * A scalar is a whole word (Core §6): a run of word characters, `.` and `-`,
 * as lookarounds once made it. Without them two rules share the work.
 * PLAIN_WORD, tried after dates and before the other scalars, takes a word
 * that starts as a scalar starts and goes on with a character that scalar
 * cannot continue with: a letter or `_` other than an exponent's `e`, a `.`
 * that no digit follows or a second `.`, a `-` that follows no `e`, a `.` or
 * `-` after an exponent, or a `.` or `-` after `null`, `true` or `false`
 * (`1.`, `1.5GB`, `1.2.3`, `10-20`, `1e+3.`, `true-ish`). WORD, tried after
 * all scalars, takes any other word whole, so that no scalar starts inside
 * one (`v1.2`, `non-null`). A number such as `1e-3` is neither.
 */
const WORD_CHARACTER = String.raw`[\w.\-]`;
const NUMBER_START = String.raw`(?:\B-|\b)(?:0|[1-9]\d*)`;
const EXPONENT = String.raw`[eE][+\-]?\d+`;
export const PLAIN_WORD = [
  String.raw`${NUMBER_START}${WORD_CHARACTER}*[^\W\deE]`,
  String.raw`${NUMBER_START}[\w\-]*\.(?:\B|[^\W\d]|[\w\-]*\.)`,
  String.raw`${NUMBER_START}(?:[\w.]*[^\WeE])?-`,
  String.raw`${NUMBER_START}(?:\.\d+)?${EXPONENT}[.\-]`,
  String.raw`\b(?:null|true|false)[.\-]`,
]
  .map((start) => `${start}${WORD_CHARACTER}*`)
  .join("|");
export const WORD = `${WORD_CHARACTER}+`;

/** Core §6.2, §6.3: `null`, `~`, `true` and `false` as whole words. */
export const NULL = String.raw`\bnull\b|\B~\B`;
export const BOOLEAN = String.raw`\b(?:true|false)\b`;

/** Core §6.5.1: ISO 8601 with an optional time and offset, `DD.MM.YYYY` and `DD/MM/YYYY`. */
export const DATE = String.raw`\b(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+\-]\d{2}:\d{2})?)?|\d{1,2}[./]\d{1,2}[./]\d{4}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?)\b`;

/** Core §6.4.1; a sign starts the number only where no word precedes it. */
export const NUMBER = String.raw`${NUMBER_START}(?:\.\d+)?(?:${EXPONENT})?\b`;

/** A fragment as the source of a JavaScript RegExp with the `u` flag, which writes a code point `\u{…}`. */
export function fragmentToJavaScript(fragment: string): string {
  return fragment.replaceAll("\\x{", "\\u{");
}

/** Translate the mechanically shared fragment subset to Emacs regexp syntax. */
export function onigurumaFragmentToEmacs(fragment: string): string {
  return fragment
    .replaceAll("(?:", String.raw`\(?:`)
    .replaceAll(")", String.raw`\)`)
    .replaceAll("|", String.raw`\|`);
}

// Emacs regexp has no general-category property syntax equivalent to
// Oniguruma's. Its Unicode-aware POSIX alnum class follows the Unicode tables
// built into the running Emacs, and category `^` covers combining marks.
// U+00B7 is written as an escape outside String.raw: Bun's transpiler turns a
// literal non-ASCII character in a raw template into the text `\u00B7`,
// which an Emacs character class reads as six ASCII characters.
const EMACS_INITIAL = String.raw`[[:alnum:]_]`;
const EMACS_CHARACTER = `[[:alnum:]_:*\u00B7-]\\|\\p{^}`;
const EMACS_SEGMENT = `${EMACS_INITIAL}\\(?:${EMACS_CHARACTER}\\)*`;
const EMACS_PARTIAL_NAME = `${EMACS_INITIAL}\\(?:${EMACS_CHARACTER}\\|/\\)*`;
export const EMACS_KEY = `${EMACS_SEGMENT}\\|'[^']*'\\|"\\(?:\\\\.\\|[^"\\\\]\\)*"`;
export const EMACS_DOCUMENT_REFERENCE = String.raw`\${${EMACS_SEGMENT}\(?:\.${EMACS_SEGMENT}\)*}`;
export const EMACS_PARTIAL_REFERENCE = String.raw`\$(${EMACS_PARTIAL_NAME}\(?:\.${EMACS_SEGMENT}\)*)`;

/** Core 1.3 §1 whitespace as an Emacs character class of the characters themselves. */
export const EMACS_WHITESPACE = `[${WHITESPACE_RANGES.map(([first, last]) =>
  first === last
    ? String.fromCodePoint(first)
    : `${String.fromCodePoint(first)}-${String.fromCodePoint(last)}`,
).join("")}]`;
