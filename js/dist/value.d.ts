/**
 * Lima Value Model — a tagged union that stands in for raw JavaScript values
 * everywhere in the parser. Precise integer/float tagging is what a Rust
 * port needs (`i64` vs `f64` are genuinely different representations there,
 * unlike JS's single `number` type) — this module carries that distinction
 * from the moment a scalar is recognised, rather than reconstructing it
 * later from formatting details.
 */
export type LimaValue = {
    kind: 'null';
} | {
    kind: 'bool';
    value: boolean;
} | {
    kind: 'int';
    value: number;
} | {
    kind: 'float';
    value: number;
} | {
    kind: 'string';
    value: string;
} | {
    kind: 'instant';
    value: Date;
} | {
    kind: 'array';
    items: LimaValue[];
} | {
    kind: 'mapping';
    entries: Map<string, LimaValue>;
};
export declare const LNull: LimaValue;
export declare const LBool: (value: boolean) => LimaValue;
export declare const LInt: (value: number) => LimaValue;
export declare const LFloat: (value: number) => LimaValue;
export declare const LString: (value: string) => LimaValue;
export declare const LInstant: (value: Date) => LimaValue;
export declare const LArray: (items: LimaValue[]) => LimaValue;
export declare const LMapping: (entries?: Map<string, LimaValue>) => LimaValue;
export declare const isScalar: (v: LimaValue) => boolean;
/** Structural deep copy — Lima references never alias their target (Core/References: no aliasing). */
export declare const deepCopy: (v: LimaValue) => LimaValue;
/**
 * References §6.2 node-count definition: `nodeCount(scalar) = 1`,
 * `nodeCount(collection) = 1 + sum(nodeCount(child))` — mapping keys do not
 * count as separate nodes.
 */
export declare const countNodes: (v: LimaValue) => number;
/**
 * Core §9 nesting-depth formula: `depth(scalar) = 0`, `depth(collection) =
 * 1 + max(depth(child))` (or 1 if empty).
 */
export declare const computeDepth: (v: LimaValue) => number;
/**
 * Canonical string representation for interpolation (References §3.5.1).
 * `Number.prototype.toString` already picks the correct fixed-vs-exponential
 * form and digit sequence (ECMAScript is the normative algorithm for both
 * the int and the float rule, within Lima's supported ranges) — this only
 * applies the lexical cleanup the spec requires on top: lowercase `e`, no
 * `+` after `e`, no leading zeros in the exponent.
 */
export declare const canonicalString: (v: LimaValue) => string;
/** References §6.2 partial resource limits. */
export declare const PARTIAL_KEY_LENGTH_LIMIT = 128;
export declare const PARTIAL_VALUE_DEPTH_LIMIT = 16;
export declare const PARTIAL_COUNT_LIMIT = 128;
export declare const PARTIAL_NAME_LENGTH_LIMIT = 128;
export declare const PARTIAL_NODE_LIMIT = 4096;
export declare const RESULT_NODE_LIMIT = 65536;
export declare const SCALAR_LENGTH_LIMIT = 16384;
/**
 * Counts Unicode code points (what every length-limit check in this
 * codebase means by "code points", never UTF-16 code units) without
 * `[...s].length`'s unconditional cost: spreading a string allocates an
 * array of every character just to read its length, ~15x slower than
 * `.length` for a typical short ASCII/BMP string (measured). A surrogate
 * pair (the only case where `.length` and code-point count differ) can
 * only occur for code points above U+FFFF — astral-plane characters like
 * emoji, vanishingly rare in real frontmatter — so scanning for one first
 * and falling back to the exact spread-based count only then keeps the
 * common case (ASCII titles, but also accented Latin/Cyrillic/CJK BMP
 * text, none of which need surrogate pairs) on the fast, allocation-free
 * path.
 */
export declare const codepointLength: (s: string) => number;
/**
 * Converts and validates a single host value against the Lima Value Model
 * (References §6.2), recursively. `seen` tracks the current recursion path
 * (not every visited object) to detect genuine cycles without rejecting
 * shared, non-cyclic substructure.
 *
 * Host types with no Lima equivalent (functions, symbols, class instances,
 * accessor properties) are rejected outright rather than silently coerced.
 * Negative zero is normalised to positive zero; Date milliseconds are
 * truncated (not rounded) to zero — both per References §6.2.
 *
 * This is the ONLY boundary in the whole implementation that touches JS
 * host-value reflection (`Object.getPrototypeOf`, `getOwnPropertyDescriptor`)
 * — a Rust port has no equivalent step at all, since its partials API takes
 * a native Rust type up front.
 */
export declare const ingestPartialValue: (value: any, partialName: string, path: string, depth?: number, seen?: Set<unknown>) => LimaValue;
