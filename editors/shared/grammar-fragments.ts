/**
 * Core 1.2 §5.1 and References 2.1 path segments. Oniguruma supports Unicode
 * general-category properties; the implementation itself uses the fixed
 * Unicode 18.0 table in js/src/unicode-key-table.ts.
 */
const KEY_INITIAL = String.raw`[\p{L}\p{N}_]`;
const KEY_CHARACTER = String.raw`[\p{L}\p{M}\p{N}_:*\u00B7-]`;
export const UNQUOTED_KEY = `${KEY_INITIAL}${KEY_CHARACTER}*`;
const DOC_PATH = `${UNQUOTED_KEY}(?:\\.${UNQUOTED_KEY})*`;
const PARTIAL_NAME = `${KEY_INITIAL}[\\p{L}\\p{M}\\p{N}_:*/\\u00B7-]*`;
const PARTIAL_PATH = `${PARTIAL_NAME}(?:\\.${UNQUOTED_KEY})*`;

/** Contents of a Core §5.2 double-quoted key, excluding its delimiters. */
export const DOUBLE_QUOTED_KEY_BODY = String.raw`(?:\\.|[^"\\])*`;

export const SINGLE_QUOTED_KEY = String.raw`'[^']*'`;
export const DOUBLE_QUOTED_KEY = `"${DOUBLE_QUOTED_KEY_BODY}"`;
export const KEY = `${UNQUOTED_KEY}|${SINGLE_QUOTED_KEY}|${DOUBLE_QUOTED_KEY}`;

export const DOCUMENT_REFERENCE = String.raw`\$\{${DOC_PATH}\}`;
export const PARTIAL_REFERENCE = String.raw`\$\(${PARTIAL_PATH}\)`;

/** Oniguruma form; Emacs keeps its procedural comment matcher. */
export const COMMENT = String.raw`(?<!\\)(#).*$`;

/** Core §15.7 literal block-scalar marker and its optional comment. */
export const BLOCK_SCALAR = String.raw`(?<=:)([ \t]+)(\|)[ \t]*(?:(#).*)?$`;

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
const EMACS_INITIAL = String.raw`[[:alnum:]_]`;
const EMACS_CHARACTER = String.raw`[[:alnum:]_:*·-]\|\p{^}`;
const EMACS_SEGMENT = `${EMACS_INITIAL}\\(?:${EMACS_CHARACTER}\\)*`;
const EMACS_PARTIAL_NAME = `${EMACS_INITIAL}\\(?:${EMACS_CHARACTER}\\|/\\)*`;
export const EMACS_KEY = `${EMACS_SEGMENT}\\|'[^']*'\\|"\\(?:\\\\.\\|[^"\\\\]\\)*"`;
export const EMACS_DOCUMENT_REFERENCE = String.raw`\${${EMACS_SEGMENT}\(?:\.${EMACS_SEGMENT}\)*}`;
export const EMACS_PARTIAL_REFERENCE = String.raw`\$(${EMACS_PARTIAL_NAME}\(?:\.${EMACS_SEGMENT}\)*)`;
