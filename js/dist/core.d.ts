/**
 * LIMA Core 1.0 parser — reference-unaware by construction (Appendix B:
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
 */
import { type LimaValue } from './value.js';
type Meta = Record<string, any>;
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
export declare const SCALAR_LENGTH_LIMIT = 16384;
export declare const NESTING_DEPTH_LIMIT = 16;
/** Core §11.2: the minimal `onWarning` diagnostic shape — message and line only. */
export type Diagnostic = {
    message: string;
    line: number;
};
/**
 * Threaded through the whole recursive descent instead of a bare `strict`
 * boolean, so `onWarning` reaches every call site that can emit a warning
 * (currently just duplicate-key detection) without growing every
 * function's parameter list further as new warning types are added.
 */
export type ParseContext = {
    strict: boolean;
    onWarning?: (diagnostic: Diagnostic) => void;
};
export type CoreOptions = {
    strict?: boolean;
    /** Core §11.2: callback for non-strict warnings (e.g. duplicate keys). Discarded if omitted. */
    onWarning?: (diagnostic: Diagnostic) => void;
};
/**
 * Parses LIMA Core 1.0 syntax into the internal annotated value tree —
 * every node carrying its source line, string leaves additionally carrying
 * whether they came from quoted syntax. `($key)`/`(%key)` text is left
 * exactly as written; nothing here ever inspects or resolves it.
 */
export declare const parseCoreWithPositions: (frontMatter: string, ctx: ParseContext) => Map<string, PositionedValue>;
/** Converts a Lima value to a plain, native JS value (the public result shape). */
export declare const toNative: (v: LimaValue) => any;
/**
 * `toNative(toPlainValue(v))` in one pass instead of two full tree walks —
 * matters most for large, reference-expanded results (many copies of a
 * sizeable partial), where the position/quoted-stripping pass and the
 * native-conversion pass would otherwise each independently visit every
 * node of the same, potentially large, final tree.
 */
export declare const toNativeFromPositioned: (v: PositionedValue) => any;
/**
 * Public Core 1.0 entry point. Never resolves `($key)`/`(%key)` text — see
 * the module doc comment. Equivalent in observable behavior to calling
 * `parseReferences()` with no partials on a document that happens to
 * contain no references, except that here reference-shaped text is
 * guaranteed to always pass through unresolved, even in strict mode.
 */
export declare const parseCore: <T extends Record<string, unknown> = Meta>(frontMatter: string, options?: CoreOptions) => T;
export {};
