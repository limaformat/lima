/** Position-annotated tree helpers shared by frozen References 1.0 and active References 2.0; contains no reference grammar or resolution logic. */
import { type InsertedAt, type NativeValue, type PositionedValue } from './core.js';
import { type LimaValue } from './value.js';
type Meta = Record<string, unknown>;
/** Every Lima mapping result must be a prototype-free object. */
export declare const emptyMapping: () => Meta;
/**
 * Structural deep copy for document-derived targets — preserves each leaf's
 * own line/quoted (§4.2/R-104: still eligible for further resolution) and
 * any existing `insertedAt` provenance from an earlier, nested resolution
 * (R-112: a reference copied wholesale into a new position can itself
 * already contain the result of an inner reference that resolved first —
 * both insertion sites remain identifiable participants after the copy).
 */
export declare const deepCopyPositioned: (v: PositionedValue) => PositionedValue;
/**
 * Wraps a partial's ingested value into the annotated representation, with
 * every string leaf marked permanently inert (§3.8: "no traversal into
 * partial values" — the resolution phases must never rediscover a
 * reference-like substring inside partial content). Called once per partial
 * name at ingestion (see the call site), producing the one canonical tree
 * every pure reference to that partial retrieves — deep-copying it on every
 * such reference (§3.1) is the resolveTree call site's job, not this one.
 */
export declare const partialToPositioned: (v: LimaValue, line: number) => PositionedValue;
/**
 * References §5/R-112 (nesting depth), §6.2 (node count), and the public
 * result shape (native conversion) computed together in one recursive pass
 * over the final, post-substitution tree — instead of three independent
 * full-tree walks (a depth-only pass, a count-only pass, then
 * `toNativeFromPositioned`), each of which would otherwise revisit every
 * node of what can be a large, reference-expanded result. Depth attribution
 * needs more than a depth number: it needs to know which reference
 * insertions lie on the actual deepest path, so the earliest of those (by
 * line) can be blamed if the limit is exceeded — ties for "deepest child"
 * all count, since a violation can be reached via more than one
 * maximal-depth branch. `native` is still built unconditionally even
 * though a depth/node-count violation elsewhere in the document means it
 * will be discarded and never returned — cheaper than adding a second
 * conditional branch to every call site, and the discarded case is the
 * rare (error) path, not the one this pass exists to speed up.
 *
 * Each array/mapping branch tracks a running max depth and its participant
 * list in a single loop over its children, instead of first materializing a
 * full array of child results and then doing separate `.map()`/`Math.max`/
 * `.filter().flatMap()` passes over it — for a wide sibling group (many
 * children at the same depth, the common shape for flat documents with many
 * top-level references) that would mean an extra full pass per level on top
 * of the traversal itself. A running accumulator only ever copies-on-write:
 * `.slice()` when a strictly greater depth replaces the running set, plain
 * `.push()` onto that fresh copy for a tie at the current max — never a
 * mutation of a child's own returned array. Reusing a child's array in
 * place would currently be safe (each node is visited exactly once, no
 * aliasing left after the pure-reference deep-copy fix), but relying on
 * that invariant here has no upside worth the risk in a file that has
 * already had one real aliasing bug.
 */
export type FinalizedValue = {
    native: NativeValue;
    nodeCount: number;
    depth: number;
    deepestParticipants: InsertedAt[];
};
export declare const finalizePositioned: (v: PositionedValue) => FinalizedValue;
/**
 * Earliest participant by source position — lowest line, then lowest
 * character offset (References §5) — or null when none exist (R-113's
 * "line 1" fallback applies then).
 */
export declare const earliestParticipant: (participants: InsertedAt[]) => InsertedAt | null;
/** Node-count attribution for the RESOURCE_LIMIT error path: every reference insertion anywhere in the tree contributes to the total. */
export declare const collectAllParticipants: (v: PositionedValue, acc: InsertedAt[]) => void;
export {};
