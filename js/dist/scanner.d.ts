/**
 * Top-level key tokenization — a hand-written scanner, not a regex, for
 * two reasons: it's measurably faster (the regex-split approach it
 * replaced re-scanned the whole document with a single large alternation
 * regex on every parse), and it removes the parser's only remaining
 * dependency on genuine backtracking-dependent regex semantics, keeping
 * the implementation representable by an RE2-family (linear-time,
 * non-backtracking) engine — relevant for a future Rust port, where the
 * standard `regex` crate is itself RE2-derived and cannot express
 * backtracking-dependent patterns at all.
 *
 * Equivalent to this regex:
 *
 *   /^(?:([a-zA-Z\d_][a-zA-Z\d_:-]*)|'([^'\n]*)'|"((?:[^"\\\n]|\\[^\n])*)"):( *\n| )/gm
 *
 * The scanner replaced an actual regex of this shape; the differential
 * testing that verified the port — over 100,000 fuzzed and structured
 * cases, the full conformance corpus, hand-built adversarial edge cases,
 * zero divergences — was against that original. The quoted-key character
 * classes have since been tightened to exclude only U+000A (Core errata
 * 1.0.8 / 1.0.9), reflected above: `[^'\n]`, `[^"\\\n]`, and `\\[^\n]` (a
 * backslash escapes any character except U+000A; the resulting sequence is
 * then validated as an escape at decode time — an unknown escape like
 * `\` + U+2028 throws in strict, is kept literally in non-strict, exactly
 * like `\q`).
 *
 * Subtle backtracking-dependent cases that are easy to get wrong without
 * empirical verification against the real parser:
 *   - `a:b: value` → key "a:b" (colon is a legal mid-key character; the
 *     mandatory separator-introducing `:` is whichever colon within the
 *     greedily-matched run is the RIGHTMOST one for which a valid
 *     separator follows it — matching real regex backtracking, which
 *     always tries the longest capture first and shrinks it only when the
 *     rest of the pattern fails to match).
 *   - `key:  value` (two spaces) → the separator consumes exactly one
 *     space; the second space becomes part of the raw value.
 *   - `key:` at end of input with no following space or `\n` → no match
 *     at all (the separator alternative `( *\n| )` requires an actual
 *     trailing newline or a literal space; end-of-string alone satisfies
 *     neither).
 *   - A raw U+000A in a quoted key aborts the match — and only U+000A:
 *     Core §15.6's single- and double-quoted-key character classes exclude
 *     U+000A alone, so U+2028 / U+2029 (and, on already-§3-normalised
 *     input, U+000D) are ordinary quoted-key characters here, matching the
 *     nested and flow key paths and the Rust/Go scanners. The `\n` escape
 *     is unaffected — it decodes to a key containing U+000A.
 *   - A backslash directly followed by U+000A inside a double-quoted key
 *     aborts the match (`\\[^\n]` — the backslash needs a non-U+000A
 *     character after it). A backslash followed by any other character,
 *     U+2028 / U+2029 included, is consumed as an escape pair here and
 *     resolved at decode time.
 */
export interface KeyMatch {
    /** One-based source line of the key. */
    line: number;
    /** Start of the whole match (a line-start position). */
    matchStart: number;
    /** Position right after the mandatory `:` — start of the separator. */
    sepStart: number;
    /** Position right after the separator — start of this key's raw content. */
    rawStart: number;
    /** True for the `( *\n)` block-form separator, false for the single-space inline form. */
    isBlock: boolean;
    /** End of the first physical value line, populated for inline matches. */
    inlineEnd?: number;
    unquoted?: string;
    singleQuoted?: string;
    doubleQuotedRaw?: string;
}
/**
 * All top-level key matches, in document order. Only line-start positions
 * (index 0, and every position right after a `\n`) are attempted,
 * mirroring `^` with the multiline flag — content between one match's raw
 * start and the next match's start (or end of document) is that key's raw
 * value text, exactly as the regex-split's discarded inter-match segments
 * were.
 */
export declare const scanKeys: (frontMatter: string) => KeyMatch[];
/** Stateful top-level token cursor; `next()` performs no text slicing. */
export declare class KeyCursor {
    private readonly source;
    tokenLine: number;
    matchStart: number;
    sepStart: number;
    rawStart: number;
    inlineEnd: number;
    keyStart: number;
    keyEnd: number;
    keyKind: number;
    isBlock: boolean;
    private pos;
    private line;
    constructor(source: string);
    next(): boolean;
}
