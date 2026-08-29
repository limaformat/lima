/** Position-annotated tree helpers shared by frozen References 1.0 and active References 2.0; contains no reference grammar or resolution logic. */
import { toNativeFromPositioned, } from './core.js';
/** Every Lima mapping result must be a prototype-free object. */
export const emptyMapping = () => Object.create(null);
/**
 * Structural deep copy for document-derived targets — preserves each leaf's
 * own line/quoted (§4.2/R-104: still eligible for further resolution) and
 * any existing `insertedAt` provenance from an earlier, nested resolution
 * (R-112: a reference copied wholesale into a new position can itself
 * already contain the result of an inner reference that resolved first —
 * both insertion sites remain identifiable participants after the copy).
 */
export const deepCopyPositioned = (v) => {
    switch (v.kind) {
        case 'array': return { kind: 'array', items: v.items.map(deepCopyPositioned), line: v.line, references2Active: v.references2Active, insertedAt: v.insertedAt };
        case 'mapping': {
            const entries = new Map();
            for (const [k, c] of v.entries)
                entries.set(k, deepCopyPositioned(c));
            return { kind: 'mapping', entries, line: v.line, references2Active: v.references2Active, insertedAt: v.insertedAt };
        }
        case 'instant': return { kind: 'instant', value: new Date(v.value.getTime()), line: v.line, insertedAt: v.insertedAt };
        default: return v;
    }
};
/**
 * Wraps a partial's ingested value into the annotated representation, with
 * every string leaf marked permanently inert (§3.8: "no traversal into
 * partial values" — the resolution phases must never rediscover a
 * reference-like substring inside partial content). Called once per partial
 * name at ingestion (see the call site), producing the one canonical tree
 * every pure reference to that partial retrieves — deep-copying it on every
 * such reference (§3.1) is the resolveTree call site's job, not this one.
 */
export const partialToPositioned = (v, line) => {
    switch (v.kind) {
        case 'null': return { kind: 'null', line };
        case 'bool': return { kind: 'bool', value: v.value, line };
        case 'int': return { kind: 'int', value: v.value, line };
        case 'float': return { kind: 'float', value: v.value, line };
        case 'string': return { kind: 'string', value: v.value, line, quoted: true };
        case 'instant': return { kind: 'instant', value: v.value, line };
        case 'array': return { kind: 'array', items: v.items.map((i) => partialToPositioned(i, line)), line };
        case 'mapping': {
            const entries = new Map();
            for (const [k, c] of v.entries)
                entries.set(k, partialToPositioned(c, line));
            return { kind: 'mapping', entries, line };
        }
    }
};
export const finalizePositioned = (v) => {
    const own = v.insertedAt ? [v.insertedAt] : [];
    if (v.kind === 'array') {
        if (v.items.length === 0)
            return { native: [], nodeCount: 1, depth: 1, deepestParticipants: own };
        const native = new Array(v.items.length);
        let nodeCount = 1;
        let maxDepth = -1;
        let childParticipants = [];
        for (let i = 0; i < v.items.length; i++) {
            const r = finalizePositioned(v.items[i]);
            native[i] = r.native;
            nodeCount += r.nodeCount;
            if (r.depth > maxDepth) {
                maxDepth = r.depth;
                childParticipants = r.deepestParticipants.slice();
            }
            else if (r.depth === maxDepth) {
                for (const p of r.deepestParticipants)
                    childParticipants.push(p);
            }
        }
        return { native, nodeCount, depth: 1 + maxDepth, deepestParticipants: own.length ? own.concat(childParticipants) : childParticipants };
    }
    if (v.kind === 'mapping') {
        if (v.entries.size === 0)
            return { native: emptyMapping(), nodeCount: 1, depth: 1, deepestParticipants: own };
        const native = emptyMapping();
        let nodeCount = 1;
        let maxDepth = -1;
        let childParticipants = [];
        for (const [k, c] of v.entries) {
            const r = finalizePositioned(c);
            native[k] = r.native;
            nodeCount += r.nodeCount;
            if (r.depth > maxDepth) {
                maxDepth = r.depth;
                childParticipants = r.deepestParticipants.slice();
            }
            else if (r.depth === maxDepth) {
                for (const p of r.deepestParticipants)
                    childParticipants.push(p);
            }
        }
        return { native: native, nodeCount, depth: 1 + maxDepth, deepestParticipants: own.length ? own.concat(childParticipants) : childParticipants };
    }
    // Scalar leaf: null/bool/int/float/string/instant. No further recursion,
    // so plain toNativeFromPositioned is exactly the single-node conversion
    // needed here — reused rather than duplicated.
    return { native: toNativeFromPositioned(v), nodeCount: 1, depth: 0, deepestParticipants: own };
};
/**
 * Earliest participant by source position — lowest line, then lowest
 * character offset (References §5) — or null when none exist (R-113's
 * "line 1" fallback applies then).
 */
export const earliestParticipant = (participants) => participants.length === 0
    ? null
    : participants.reduce((a, b) => b.line < a.line || (b.line === a.line && (b.offset ?? 0) < (a.offset ?? 0)) ? b : a);
/** Node-count attribution for the RESOURCE_LIMIT error path: every reference insertion anywhere in the tree contributes to the total. */
export const collectAllParticipants = (v, acc) => {
    if (v.insertedAt)
        acc.push(v.insertedAt);
    if (v.kind === 'array')
        for (const item of v.items)
            collectAllParticipants(item, acc);
    if (v.kind === 'mapping')
        for (const c of v.entries.values())
            collectAllParticipants(c, acc);
};
