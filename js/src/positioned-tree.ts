/** Position-annotated tree helpers shared by frozen References 1.0 and active References 2.0; contains no reference grammar or resolution logic. */

import {
	toNativeFromPositioned,
	type InsertedAt, type NativeValue, type PositionedValue,
} from './core.js'
import { type LimaValue } from './value.js'

type Meta = Record<string, unknown>

/** Every Lima mapping result must be a prototype-free object. */
export const emptyMapping = (): Meta => Object.create(null)

/**
 * Structural deep copy for document-derived targets — preserves each leaf's
 * own line/quoted (§4.2/R-104: still eligible for further resolution) and
 * any existing `insertedAt` provenance from an earlier, nested resolution
 * (R-112: a reference copied wholesale into a new position can itself
 * already contain the result of an inner reference that resolved first —
 * both insertion sites remain identifiable participants after the copy).
 */
export const deepCopyPositioned = (v: PositionedValue): PositionedValue => {
	switch (v.kind) {
		case 'array': return { kind: 'array', items: v.items.map(deepCopyPositioned), line: v.line, references2Active: v.references2Active, insertedAt: v.insertedAt, priorInsertions: v.priorInsertions }
		case 'mapping': {
			const entries = new Map<string, PositionedValue>()
			for (const [k, c] of v.entries) entries.set(k, deepCopyPositioned(c))
			return { kind: 'mapping', entries, line: v.line, references2Active: v.references2Active, insertedAt: v.insertedAt, priorInsertions: v.priorInsertions }
		}
		case 'instant': return { kind: 'instant', value: new Date(v.value.getTime()), line: v.line, insertedAt: v.insertedAt, priorInsertions: v.priorInsertions }
		default: return v
	}
}

/**
 * Wraps a partial's ingested value into the annotated representation, with
 * every string leaf marked permanently inert (§3.8: "no traversal into
 * partial values" — the resolution phases must never rediscover a
 * reference-like substring inside partial content). Called once per partial
 * name at ingestion (see the call site), producing the one canonical tree
 * every pure reference to that partial retrieves — deep-copying it on every
 * such reference (§3.1) is the resolveTree call site's job, not this one.
 */
export const partialToPositioned = (v: LimaValue, line: number): PositionedValue => {
	switch (v.kind) {
		case 'null': return { kind: 'null', line }
		case 'bool': return { kind: 'bool', value: v.value, line }
		case 'int': return { kind: 'int', value: v.value, line }
		case 'float': return { kind: 'float', value: v.value, line }
		case 'string': return { kind: 'string', value: v.value, line, quoted: true }
		case 'instant': return { kind: 'instant', value: v.value, line }
		case 'array': return { kind: 'array', items: v.items.map((i) => partialToPositioned(i, line)), line }
		case 'mapping': {
			const entries = new Map<string, PositionedValue>()
			for (const [k, c] of v.entries) entries.set(k, partialToPositioned(c, line))
			return { kind: 'mapping', entries, line }
		}
	}
}

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
export type FinalizedValue = { native: NativeValue; nodeCount: number; depth: number; deepestParticipants: InsertedAt[] }

export const finalizePositioned = (v: PositionedValue): FinalizedValue => {
	const own = v.insertedAt ? [...(v.priorInsertions ?? []), v.insertedAt] : (v.priorInsertions ?? [])
	if (v.kind === 'array') {
		if (v.items.length === 0) return { native: [], nodeCount: 1, depth: 1, deepestParticipants: own }
		const native: NativeValue[] = new Array(v.items.length)
		let nodeCount = 1
		let maxDepth = -1
		let childParticipants: InsertedAt[] = []
		for (let i = 0; i < v.items.length; i++) {
			const r = finalizePositioned(v.items[i])
			native[i] = r.native
			nodeCount += r.nodeCount
			if (r.depth > maxDepth) { maxDepth = r.depth; childParticipants = r.deepestParticipants.slice() }
			else if (r.depth === maxDepth) { for (const p of r.deepestParticipants) childParticipants.push(p) }
		}
		return { native, nodeCount, depth: 1 + maxDepth, deepestParticipants: own.length ? own.concat(childParticipants) : childParticipants }
	}
	if (v.kind === 'mapping') {
		if (v.entries.size === 0) return { native: emptyMapping() as NativeValue, nodeCount: 1, depth: 1, deepestParticipants: own }
		const native = emptyMapping()
		let nodeCount = 1
		let maxDepth = -1
		let childParticipants: InsertedAt[] = []
		for (const [k, c] of v.entries) {
			const r = finalizePositioned(c)
			native[k] = r.native
			nodeCount += r.nodeCount
			if (r.depth > maxDepth) { maxDepth = r.depth; childParticipants = r.deepestParticipants.slice() }
			else if (r.depth === maxDepth) { for (const p of r.deepestParticipants) childParticipants.push(p) }
		}
		return { native: native as NativeValue, nodeCount, depth: 1 + maxDepth, deepestParticipants: own.length ? own.concat(childParticipants) : childParticipants }
	}
	// Scalar leaf: null/bool/int/float/string/instant. No further recursion,
	// so plain toNativeFromPositioned is exactly the single-node conversion
	// needed here — reused rather than duplicated.
	return { native: toNativeFromPositioned(v), nodeCount: 1, depth: 0, deepestParticipants: own }
}

/**
 * Earliest participant by source position — lowest line, then lowest
 * character offset (References §5) — or null when none exist (R-113's
 * "line 1" fallback applies then).
 */
export const earliestParticipant = (participants: InsertedAt[]): InsertedAt | null =>
	participants.length === 0
		? null
		: participants.reduce((a, b) =>
			b.line < a.line || (b.line === a.line && (b.offset ?? 0) < (a.offset ?? 0)) ? b : a,
		)

/** Node-count attribution for the RESOURCE_LIMIT error path: every reference insertion anywhere in the tree contributes to the total. */
export const collectAllParticipants = (v: PositionedValue, acc: InsertedAt[]): void => {
	if (v.priorInsertions) acc.push(...v.priorInsertions)
	if (v.insertedAt) acc.push(v.insertedAt)
	if (v.kind === 'array') for (const item of v.items) collectAllParticipants(item, acc)
	if (v.kind === 'mapping') for (const c of v.entries.values()) collectAllParticipants(c, acc)
}
