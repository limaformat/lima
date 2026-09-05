/**
 * Core scalar grammar: the annotated `PositionedValue` tree type, dates,
 * numbers/type coercion, quoting/escaping, and the shared quoted-or-typed
 * scalar parser every value position (inline values, flow items, block
 * array/map items) builds on.
 */
import { type LimaValue } from './value.js';
import { type ParseContext } from './normalize.js';
import type { ValueBuilder } from './builder.js';
import { type ReferenceSource, type ReferenceToken2 } from './reference-tokens2.js';
/**
 * `insertedAt` is never set by Core — it's a References-only annotation
 * (see references.ts's `resolveTree`), stamped on the root of a value
 * copied in by a successful pure-reference resolution, with the source
 * token, line, and character offset that caused the insertion. It powers
 * References §5's global-error attribution (R-112): when a final-result
 * limit (nesting depth, total node count) is violated, the lowest source
 * position (`line`, then `offset`) among the participating nodes identifies
 * which reference token to blame — the spec requires the error message to
 * include both the token and the line. `priorInsertions` retains older
 * root provenance when a resolved pure-reference result is copied again.
 */
export type InsertedAt = {
    line: number;
    token: string;
    offset?: number;
};
export type PositionedValue = {
    kind: 'null';
    line: number;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'bool';
    value: boolean;
    line: number;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'int';
    value: number;
    line: number;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'float';
    value: number;
    line: number;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'string';
    value: string;
    line: number;
    quoted: boolean;
    references2?: ReferenceToken2[];
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'instant';
    value: Date;
    line: number;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'array';
    items: PositionedValue[];
    line: number;
    references2Active?: boolean;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
} | {
    kind: 'mapping';
    entries: Map<string, PositionedValue>;
    line: number;
    references2Active?: boolean;
    insertedAt?: InsertedAt;
    priorInsertions?: InsertedAt[];
};
export declare const hasActiveReferences2: (value: PositionedValue) => boolean;
/** The `ValueBuilder<PositionedValue>` — reconstructs today's annotated tree exactly, for References. */
export declare const positionedBuilder: ValueBuilder<PositionedValue>;
/** Strips position/quoted-origin annotations, recursively — the public parseCore() projection. */
export declare const toPlainValue: (v: PositionedValue) => LimaValue;
export declare const NO_SPAN_VALUE: unique symbol;
/**
 * Parses allocation-free scalar forms whose complete grammar can be proven
 * directly from one source span. Everything else returns a sentinel and is
 * handled by the full string-based scalar/flow grammar.
 */
export declare const parseSimpleScalarSpan: <V, M>(source: string, start: number, end: number, line: number, strict: boolean, builder: ValueBuilder<V, M>) => V | typeof NO_SPAN_VALUE;
/**
 * Index of the quote that closes a quoted scalar opening at `s[0]`, or -1
 * if it is never closed. Escape-aware, so `"a\""` closes at its last
 * character rather than the escaped inner `"`:
 *   - double quotes: a backslash escapes the next character (§6.1.2);
 *   - single-quoted *values* (§6.1.3 "Backslash pairing"): scanning left
 *     to right, `\\` (two literal backslashes) and `\'` (an escaped quote)
 *     are each consumed as a two-character unit, so a lone `\` is literal
 *     and a closing `'` after an even backslash run closes the string.
 *     Pass `singleQuoteEscape = false` for single-quoted *keys*, which are
 *     fully literal (§5.2), where the first `'` closes.
 * `s[0]` is assumed to be `'` or `"`.
 */
export declare const closingQuoteIndex: (s: string, singleQuoteEscape?: boolean) => number;
/**
 * Whether `raw` (a key candidate as written, before quote stripping) is a
 * usable Lima key:
 *   - a quoted string that is properly closed at its final character, or
 *   - an unquoted token matching the Core §5.1 grammar.
 *
 * §5.1 is a closed pattern: a key with a space, a dot, a slash, a paren, or
 * any other character outside `[a-zA-Z0-9_:\-]` (a surviving NBSP included)
 * is not an unquoted key. Per §4, such a line/item is unrecognised and
 * skipped in *both* modes — §10's strict error list stays closed. The three
 * mapping contexts (top level, block-nested, flow) now share this one
 * check; `docs/decisions/structural-indentation-unicode-whitespace.md`
 * governs only whether Unicode whitespace counts as *indentation*, not
 * whether it may appear in a key.
 */
export declare const isValidKey: (raw: string) => boolean;
export declare const unescapeDQ: (s: string, strict?: boolean, line?: number) => string;
/**
 * The value text with a trailing `#` comment removed, but with `\#`
 * escapes left as written. This is the *physical* form a References 2.0
 * token's column is measured against (§2.4): the comment is not part of
 * the value (so its `${…}`-shaped text must not be scanned as a token),
 * but a `\#` before a token still occupies its two source columns.
 *
 * `trimEnd()` is exactly the project whitespace set (ECMAScript WhiteSpace
 * + LineTerminator = `isTrimWhitespace`) — a U+00A0 / FEFF between the
 * value and the `#` is not part of the value. The Rust and Go ports must
 * use `is_trim_whitespace` here, not a host `trim_end` or `" \t"`.
 */
export declare const stripCommentKeepEscapes: (val: string) => string;
/**
 * The value text with a trailing `#` comment removed and each `\#` *outside*
 * a quoted string collapsed to `#` (Core §6.1.4 — the escaped-hash rule is
 * defined for unquoted values only). Inside `"..."` / `'...'` the backslash
 * is left intact: `\#` there is an unknown double-quoted escape (§6.1.2:
 * strict throws, non-strict keeps it) or a literal backslash in a
 * single-quoted string (§6.1.3). Finds the same comment boundary as
 * `stripCommentKeepEscapes` — the two must agree, they annotate the same
 * value.
 */
export declare const stripComment: (val: string) => string;
/**
 * Strips a key's surrounding quotes — unescaping a double-quoted key
 * (§6.1.2 escapes, strict-checked), taking a single-quoted key literally
 * (§5.2). Returns `s` unchanged when it is not a properly-closed quoted
 * string. Callers gate on `isValidKey` first, so an unterminated or
 * trailing-content key never reaches here as a real key.
 */
export declare const stripKeyQuotes: (s: string, strict?: boolean, line?: number) => string;
/**
 * Quoted-or-typed scalar, shared by every value position (top-level inline
 * values, flow-sequence/flow-mapping items, block-array scalar items).
 * §10.1's two quoted-string strict checks — "unterminated quoted string"
 * and "non-whitespace content after closing quote in an inline value" —
 * apply in every one of those positions, so they are enforced here rather
 * than gated to the top level.
 */
export declare const parseQuotedOrTyped: <V, M>(raw: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>, source?: ReferenceSource) => V;
export declare const parseScalarValue: <V, M>(raw: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>, source?: ReferenceSource) => V;
