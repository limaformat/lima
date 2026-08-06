/**
 * Lima Core 1.0 parser — reference-unaware by construction (Appendix B:
 * reference resolution is exclusively the concern of the optional
 * References extension). `($key)`/`(%key)`-shaped text is never
 * recognised or coerced here; it simply falls through as an ordinary
 * string, indistinguishable from any other unrecognised text.
 *
 * `parseCoreWithPositions` builds the internal annotated value tree — a
 * `PositionedValue` per node, carrying the source line and (for strings)
 * whether it came from quoted syntax. This one-pass output is the shared
 * primitive the References layer (`references.ts`) builds on: it locates
 * reference-shaped string leaves, and reads each site's line directly off
 * its node instead of re-deriving position information after the fact.
 * `parseCore` is the public, position-free projection of the same parse.
 *
 * The grammar itself lives in `normalize.ts` (shared context/limits),
 * `scalars.ts` (dates, numbers, quoting, the `PositionedValue` tree type),
 * `flow.ts` (`[...]`/`{...}`), and `block.ts` (indentation-based sequences
 * and mappings) — this file is the orchestrator that ties them together.
 */
import { type LimaValue } from './value.js';
import { type ParseContext, type Diagnostic } from './normalize.js';
import { type PositionedValue } from './scalars.js';
import type { ValueBuilder } from './builder.js';
export type { Diagnostic, ParseContext } from './normalize.js';
export { NESTING_DEPTH_LIMIT, SCALAR_LENGTH_LIMIT } from './normalize.js';
export type { PositionedValue, InsertedAt } from './scalars.js';
export { toPlainValue } from './scalars.js';
type Meta = Record<string, unknown>;
export type CoreOptions = {
    strict?: boolean;
    /** Core §11.2: callback for non-strict warnings (e.g. duplicate keys). Discarded if omitted. */
    onWarning?: (diagnostic: Diagnostic) => void;
};
/**
 * Parses Lima Core 1.0 syntax into the internal annotated value tree —
 * every node carrying its source line, string leaves additionally carrying
 * whether they came from quoted syntax. `($key)`/`(%key)` text is left
 * exactly as written; nothing here ever inspects or resolves it. The
 * primitive the References layer (`references.ts`) builds on.
 */
export declare const parseCoreWithPositions: (frontMatter: string, ctx: ParseContext) => Map<string, PositionedValue>;
/** The public result shape (Core §11.1): every value `toNative*` can produce. */
export type NativeValue = null | boolean | number | string | Date | NativeValue[] | {
    [key: string]: NativeValue;
};
/**
 * The `ValueBuilder<NativeValue>` — `parseCore`'s fast path. Every scalar
 * builder is the identity function: unlike `positionedBuilder`, there is no
 * wrapper object to allocate at all, only the value itself. `array` and
 * `mapping` build the exact public shape directly (a real array; a
 * prototype-free object per Core §11.1), so `parseCore` never needs a
 * separate conversion pass over an intermediate tree afterward.
 */
export declare const nativeBuilder: ValueBuilder<NativeValue, Record<string, NativeValue>>;
/** Converts a Lima value to a plain, native JS value (the public result shape). */
export declare const toNative: (v: LimaValue) => NativeValue;
/**
 * `toNative(toPlainValue(v))` in one pass instead of two full tree walks —
 * matters most for large, reference-expanded results (many copies of a
 * sizeable partial), where the position/quoted-stripping pass and the
 * native-conversion pass would otherwise each independently visit every
 * node of the same, potentially large, final tree.
 */
export declare const toNativeFromPositioned: (v: PositionedValue) => NativeValue;
/**
 * Public Core 1.0 entry point. Never resolves `($key)`/`(%key)` text — see
 * the module doc comment. Equivalent in observable behavior to calling
 * `parseReferences()` with no partials on a document that happens to
 * contain no references, except that here reference-shaped text is
 * guaranteed to always pass through unresolved, even in strict mode.
 */
export declare const parseCore: <T extends Record<string, unknown> = Meta>(frontMatter: string, options?: CoreOptions) => T;
