/**
 * Lima Value Model — a tagged union that stands in for raw JavaScript values
 * everywhere in the parser. Precise integer/float tagging is what a Rust
 * port needs (`i64` vs `f64` are genuinely different representations there,
 * unlike JS's single `number` type) — this module carries that distinction
 * from the moment a scalar is recognised, rather than reconstructing it
 * later from formatting details.
 */
import { LimaError } from './errors.js';
export const LNull = { kind: 'null' };
export const LBool = (value) => ({ kind: 'bool', value });
export const LInt = (value) => ({ kind: 'int', value: value === 0 ? 0 : value });
export const LFloat = (value) => ({ kind: 'float', value: value === 0 ? 0 : value });
export const LString = (value) => ({ kind: 'string', value });
export const LInstant = (value) => ({ kind: 'instant', value });
export const LArray = (items) => ({ kind: 'array', items });
export const LMapping = (entries = new Map()) => ({ kind: 'mapping', entries });
export const isScalar = (v) => v.kind === 'null' || v.kind === 'bool' || v.kind === 'int' || v.kind === 'float' ||
    v.kind === 'string' || v.kind === 'instant';
/** Structural deep copy — Lima references never alias their target (Core/References: no aliasing). */
export const deepCopy = (v) => {
    switch (v.kind) {
        case 'instant': return { kind: 'instant', value: new Date(v.value.getTime()) };
        case 'array': return { kind: 'array', items: v.items.map(deepCopy) };
        case 'mapping': {
            const entries = new Map();
            for (const [k, child] of v.entries)
                entries.set(k, deepCopy(child));
            return { kind: 'mapping', entries };
        }
        default: return v; // scalars are immutable value types — sharing is safe
    }
};
/**
 * References §6.2 node-count definition: `nodeCount(scalar) = 1`,
 * `nodeCount(collection) = 1 + sum(nodeCount(child))` — mapping keys do not
 * count as separate nodes.
 */
export const countNodes = (v) => {
    if (v.kind === 'array')
        return 1 + v.items.reduce((sum, item) => sum + countNodes(item), 0);
    if (v.kind === 'mapping') {
        let sum = 1;
        for (const child of v.entries.values())
            sum += countNodes(child);
        return sum;
    }
    return 1;
};
/**
 * Core §9 nesting-depth formula: `depth(scalar) = 0`, `depth(collection) =
 * 1 + max(depth(child))` (or 1 if empty).
 */
export const computeDepth = (v) => {
    if (v.kind === 'array') {
        return v.items.length === 0 ? 1 : 1 + Math.max(...v.items.map(computeDepth));
    }
    if (v.kind === 'mapping') {
        const children = [...v.entries.values()];
        return children.length === 0 ? 1 : 1 + Math.max(...children.map(computeDepth));
    }
    return 0;
};
/**
 * Canonical string representation for interpolation (References §3.5.1).
 * `Number.prototype.toString` already picks the correct fixed-vs-exponential
 * form and digit sequence (ECMAScript is the normative algorithm for both
 * the int and the float rule, within Lima's supported ranges) — this only
 * applies the lexical cleanup the spec requires on top: lowercase `e`, no
 * `+` after `e`, no leading zeros in the exponent.
 */
export const canonicalString = (v) => {
    switch (v.kind) {
        case 'null': return '';
        case 'bool': return v.value ? 'true' : 'false';
        case 'instant': return v.value.toISOString().replace(/\.\d{3}Z$/, 'Z');
        case 'string': return v.value;
        case 'int':
        case 'float': {
            const s = String(v.value);
            return s.includes('e') || s.includes('E')
                ? s.replace(/[eE]\+?(-?)0*(\d+)/, 'e$1$2')
                : s;
        }
        default: return '';
    }
};
// ─── Partial ingestion: host JS values → LimaValue ────────────────────────
/** References §6.2 partial resource limits. */
export const PARTIAL_KEY_LENGTH_LIMIT = 128;
export const PARTIAL_VALUE_DEPTH_LIMIT = 16;
export const PARTIAL_COUNT_LIMIT = 128;
export const PARTIAL_NAME_LENGTH_LIMIT = 128;
export const PARTIAL_NODE_LIMIT = 4096;
export const RESULT_NODE_LIMIT = 65536;
export const SCALAR_LENGTH_LIMIT = 16384;
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
export const ingestPartialValue = (value, partialName, path, depth = 0, seen = new Set()) => {
    const invalid = (reason) => {
        throw new LimaError({
            code: 'INVALID_PARTIAL', partial: partialName, path,
            message: `LIMA: invalid partial "${partialName}" at path "${path}": ${reason}`,
        });
    };
    if (value === null)
        return LNull;
    if (typeof value === 'boolean')
        return LBool(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            invalid('non-finite number');
        return LFloat(value);
    }
    if (typeof value === 'string') {
        if ([...value].length > SCALAR_LENGTH_LIMIT) {
            invalid(`string exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points`);
        }
        return LString(value);
    }
    if (value instanceof Date) {
        if (isNaN(value.getTime()))
            invalid('invalid date');
        const year = value.getUTCFullYear();
        if (year < 1 || year > 9999)
            invalid(`date year ${year} outside the range 0001-9999`);
        return LInstant(new Date(Math.floor(value.getTime() / 1000) * 1000));
    }
    if (value === undefined || typeof value !== 'object') {
        invalid('unsupported value type'); // undefined, function, symbol, bigint, ...
    }
    if (seen.has(value))
        invalid('cyclic reference');
    if (depth >= PARTIAL_VALUE_DEPTH_LIMIT) {
        invalid(`nesting depth exceeds maximum of ${PARTIAL_VALUE_DEPTH_LIMIT}`);
    }
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
        result = LArray(value.map((item, i) => {
            if (Array.isArray(item)) {
                throw new LimaError({
                    code: 'INVALID_PARTIAL', partial: partialName, path: `${path}[${i}]`,
                    message: `LIMA: invalid partial "${partialName}" at path "${path}[${i}]": nested arrays are not supported`,
                });
            }
            return ingestPartialValue(item, partialName, `${path}[${i}]`, depth + 1, seen);
        }));
    }
    else {
        // Plain-object check: `Object.keys()` alone can't distinguish a class
        // instance's own data properties from a genuine plain mapping — a
        // prototype check can. `Object.create(null)` (proto === null) is also
        // accepted.
        const proto = Object.getPrototypeOf(value);
        if (proto !== null && proto !== Object.prototype)
            invalid('unsupported value type');
        const entries = new Map();
        for (const key of Object.keys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) {
                throw new LimaError({
                    code: 'INVALID_PARTIAL', partial: partialName, path: `${path}.${key}`,
                    message: `LIMA: invalid partial "${partialName}" at path "${path}.${key}": accessor properties are not supported`,
                });
            }
            if ([...key].length > PARTIAL_KEY_LENGTH_LIMIT) {
                throw new LimaError({
                    code: 'INVALID_PARTIAL', partial: partialName, path: `${path}.${key}`,
                    message: `LIMA: invalid partial "${partialName}" at path "${path}.${key}": key exceeds maximum length of ${PARTIAL_KEY_LENGTH_LIMIT} code points`,
                });
            }
            entries.set(key, ingestPartialValue(value[key], partialName, `${path}.${key}`, depth + 1, seen));
        }
        result = LMapping(entries);
    }
    seen.delete(value);
    return result;
};
