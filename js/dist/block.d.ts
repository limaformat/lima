/**
 * Core §7 block collections (sequences and mappings) — a direct structural
 * port of the legacy block parser, with every value position now producing
 * a `PositionedValue` instead of a raw JS value, and with no reference-
 * resolution concerns at all (no `resolve()` call anywhere, no
 * array-as-sequence-item reference-shape check — that error class cannot
 * occur here since Core never resolves a reference in the first place).
 */
import { type ParseContext } from './normalize.js';
import { type PositionedValue } from './scalars.js';
export declare const findKeySep: (s: string) => number;
/**
 * Recursively parses a block value (array or mapping) from an array of
 * lines.
 */
export declare const parseBlock: (lines: string[], startIdx: number, baseIndent: number, ctx: ParseContext, baseLine: number) => {
    value: PositionedValue | null;
    nextIdx: number;
};
