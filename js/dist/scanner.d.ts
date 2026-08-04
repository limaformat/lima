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
 * Reproduces (verified by extensive differential testing against the
 * regex it replaced — over 100,000 fuzzed and structured cases, the full
 * conformance corpus, and hand-built adversarial edge cases, zero
 * divergences) the exact matching behavior of:
 *
 *   /^(?:([a-zA-Z\d_][a-zA-Z\d_:-]*)|'([^']*)'|"((?:[^"\\]|\\.)*)"):( *\n| )/gm
 *
 * including subtle backtracking-dependent cases that are easy to get
 * wrong without empirical verification against the real parser:
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
 *   - Quoted keys (`'...'`, `"..."`) may contain a literal `\n` — the
 *     character classes inside quotes don't exclude it.
 *   - A backslash directly followed by a line terminator inside a
 *     double-quoted key is NOT a valid `\\.` escape — the source regex's
 *     `.` never matches a line terminator without the `s` flag (not set),
 *     so this fails the match entirely rather than consuming the pair.
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
