/**
 * Core scalar grammar: the annotated `PositionedValue` tree type, dates,
 * numbers/type coercion, quoting/escaping, and the shared quoted-or-typed
 * scalar parser every value position (inline values, flow items, block
 * array/map items) builds on.
 */
import { type LimaValue } from './value.js';
import { type ParseContext } from './normalize.js';
import type { ValueBuilder } from './builder.js';
import { type ReferenceToken2 } from './reference-tokens2.js';
/**
 * `insertedAt` is never set by Core — it's a References-only annotation
 * (see references.ts's `resolveTree`), stamped on the root of a value
 * copied in by a successful pure-reference resolution, with the source
 * token and line that caused the insertion. It powers References §5's
 * global-error attribution (R-112): when a final-result limit (nesting
 * depth, total node count) is violated, the lowest-line `insertedAt` among
 * the participating nodes identifies which reference token to blame — the
 * spec requires the error message to include both the token and the line.
 */
export type InsertedAt = {
    line: number;
    token: string;
};
export type PositionedValue = {
    kind: 'null';
    line: number;
    insertedAt?: InsertedAt;
} | {
    kind: 'bool';
    value: boolean;
    line: number;
    insertedAt?: InsertedAt;
} | {
    kind: 'int';
    value: number;
    line: number;
    insertedAt?: InsertedAt;
} | {
    kind: 'float';
    value: number;
    line: number;
    insertedAt?: InsertedAt;
} | {
    kind: 'string';
    value: string;
    line: number;
    quoted: boolean;
    references2?: ReferenceToken2[];
    insertedAt?: InsertedAt;
} | {
    kind: 'instant';
    value: Date;
    line: number;
    insertedAt?: InsertedAt;
} | {
    kind: 'array';
    items: PositionedValue[];
    line: number;
    references2Active?: boolean;
    insertedAt?: InsertedAt;
} | {
    kind: 'mapping';
    entries: Map<string, PositionedValue>;
    line: number;
    references2Active?: boolean;
    insertedAt?: InsertedAt;
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
 *   - single-quoted *values*: `\'` and `\\` are the only special sequences
 *     (§6.1.3), so a lone `\` is literal and `\\'` closes after two
 *     backslashes — pass `singleQuoteEscape = false` for single-quoted
 *     *keys*, which are fully literal (§5.2), where the first `'` closes.
 * `s[0]` is assumed to be `'` or `"`.
 */
export declare const closingQuoteIndex: (s: string, singleQuoteEscape?: boolean) => number;
/**
 * Whether `raw` (a key candidate as written, before quote stripping) is a
 * usable Lima key:
 *   - a quoted string that is properly closed at its final character, or
 *   - an unquoted token with no interior ASCII space or tab.
 *
 * §5.2 states plainly that a key containing a space must be quoted, so an
 * unquoted key with a space (`bad key`, `"unterminated`) is not a key and
 * the caller treats the line/item as unrecognised. Deliberately ASCII-only
 * (space/tab), not the full Unicode whitespace class: Core §3's structural
 * indentation is ASCII-space-only, and the top-level/block scanners already
 * strip *leading* Unicode whitespace via `isTrimWhitespace` before a key
 * candidate ever reaches here — a Unicode space that survives into a key
 * (e.g. NBSP after the leading run) is deliberate literal content, not a
 * separator, matching `docs/decisions/structural-indentation-unicode-whitespace.md`.
 * Unquoted keys with other non-§5.1 punctuation (`a.b`, `($x)`) are also
 * *not* rejected here: the frozen 1.0 corpus already relies on flow keys
 * like `{($a): v}` parsing literally, and tightening that further is a
 * later errata question, not a bug fix.
 */
export declare const isValidKey: (raw: string) => boolean;
export declare const unescapeDQ: (s: string, strict?: boolean, line?: number) => string;
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
export declare const parseQuotedOrTyped: <V, M>(raw: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>) => V;
export declare const parseScalarValue: <V, M>(raw: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>) => V;
