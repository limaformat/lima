/**
 * Core scalar grammar: the annotated `PositionedValue` tree type, dates,
 * numbers/type coercion, quoting/escaping, and the shared quoted-or-typed
 * scalar parser every value position (inline values, flow items, block
 * array/map items) builds on.
 */
import { type LimaValue } from './value.js';
import { type ParseContext } from './normalize.js';
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
    insertedAt?: InsertedAt;
} | {
    kind: 'mapping';
    entries: Map<string, PositionedValue>;
    line: number;
    insertedAt?: InsertedAt;
};
/** Strips position/quoted-origin annotations, recursively — the public parseCore() projection. */
export declare const toPlainValue: (v: PositionedValue) => LimaValue;
export declare const unescapeDQ: (s: string, strict?: boolean, line?: number) => string;
export declare const stripComment: (val: string) => string;
/** Strips a key's surrounding quotes (unescaping double-quoted keys), or returns it unchanged. */
export declare const stripKeyQuotes: (s: string) => string;
/**
 * Quoted-or-typed scalar, shared by every value position (top-level inline
 * values, flow-sequence/flow-mapping items, block-array scalar items).
 * `topLevel` gates two checks that only apply at the outermost resolveValue
 * call site in the legacy parser and are deliberately not extended to flow
 * items here, to keep this a faithful behavioral port: the "unclosed flow
 * bracket" throw and the "non-whitespace after closing quote" strict throw.
 */
export declare const parseQuotedOrTyped: (raw: string, ctx: ParseContext, line: number, topLevel: boolean) => PositionedValue;
export declare const parseScalarValue: (raw: string, ctx: ParseContext, line: number) => PositionedValue;
