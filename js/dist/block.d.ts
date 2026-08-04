/**
 * Core §7 block collections (sequences and mappings) — a direct structural
 * port of the legacy block parser, generic over its output representation
 * (see `builder.ts`) so `parseCore` can build the public native result
 * directly, without also building the References-only annotated
 * `PositionedValue` tree it never needs. No reference-resolution concerns
 * at all (no `resolve()` call anywhere, no array-as-sequence-item
 * reference-shape check — that error class cannot occur here since Core
 * never resolves a reference in the first place).
 */
import { type ParseContext } from './normalize.js';
import type { ValueBuilder } from './builder.js';
export declare const findKeySep: (s: string) => number;
/**
 * Recursively parses a block value (array or mapping) from an array of
 * lines.
 */
export declare const parseBlock: <V>(lines: string[], startIdx: number, baseIndent: number, ctx: ParseContext, baseLine: number, builder: ValueBuilder<V>) => {
    value: V | null;
    nextIdx: number;
};
