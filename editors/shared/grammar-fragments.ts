import {
  DOC_PATH,
  PARTIAL_PATH,
  SEGMENT,
} from "../../js/src/reference-tokens2.js";

/** Core §5.1 and References 2.0 path segments share this character class. */
export const UNQUOTED_KEY = SEGMENT;

/** Contents of a Core §5.2 double-quoted key, excluding its delimiters. */
export const DOUBLE_QUOTED_KEY_BODY = String.raw`(?:\\.|[^"\\])*`;

export const SINGLE_QUOTED_KEY = String.raw`'[^']*'`;
export const DOUBLE_QUOTED_KEY = `"${DOUBLE_QUOTED_KEY_BODY}"`;
export const KEY = `${UNQUOTED_KEY}|${SINGLE_QUOTED_KEY}|${DOUBLE_QUOTED_KEY}`;

export const DOCUMENT_REFERENCE = String.raw`\$\{${DOC_PATH}\}`;
export const PARTIAL_REFERENCE = String.raw`\$\(${PARTIAL_PATH}\)`;

/** Oniguruma form; Emacs keeps its procedural comment matcher. */
export const COMMENT = String.raw`(?<!\\)(#).*$`;

/** Translate the mechanically shared fragment subset to Emacs regexp syntax. */
export function onigurumaFragmentToEmacs(fragment: string): string {
  return fragment
    .replaceAll("(?:", String.raw`\(?:`)
    .replaceAll(")", String.raw`\)`)
    .replaceAll("|", String.raw`\|`);
}

export const EMACS_KEY = onigurumaFragmentToEmacs(KEY);
export const EMACS_DOCUMENT_REFERENCE = String.raw`\${${onigurumaFragmentToEmacs(DOC_PATH)}}`;
export const EMACS_PARTIAL_REFERENCE = String.raw`\$(${onigurumaFragmentToEmacs(PARTIAL_PATH)})`;
