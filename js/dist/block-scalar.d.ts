/**
 * Core §6.1.5 literal block scalars (`|`). Shared by the top-level key path
 * (`core.ts`) and the nested block path (`block.ts`): §6.1.5 defines block
 * scalar extent generically ("indentation strictly greater than the
 * indentation of the key that introduced the scalar"), with no top-level
 * restriction, so both call sites must agree byte for byte.
 *
 * Generic over the output representation via `ValueBuilder` (see
 * `builder.ts`), like the rest of the Core grammar.
 */
import { type ParseContext } from './normalize.js';
import type { ValueBuilder } from './builder.js';
/** Leading U+0020 count. "Indentation" in §6.1.5 is spaces, measured from column 0. */
export declare const leadingSpaces: (line: string) => number;
/** Index right after the last non-space character — the `trimEnd()` boundary, without allocating. */
export declare const trailingSpaceEnd: (line: string) => number;
/**
 * Builds a `|` block scalar value.
 *
 * `bodyLines` are the physical source lines *after* the `|` line, each in
 * its original column-0 form (trailing whitespace is stripped here).
 * `keyIndent` is the indentation of the key that introduced the scalar
 * (0 at the top level). `pipeLine` is the 1-based line number of the `|`
 * line, so `bodyLines[i]` is at `pipeLine + 1 + i`.
 *
 * Returns the joined value plus how many of `bodyLines` the scalar
 * consumed — a caller iterating physical lines resumes past that; a caller
 * that already sliced the range to the scalar can ignore it.
 */
export declare const buildBlockScalar: <V, M>(bodyLines: string[], keyIndent: number, pipeLine: number, ctx: ParseContext, builder: ValueBuilder<V, M>) => {
    value: V;
    consumed: number;
};
