/**
 * Lima References 1.0 — layered strictly on top of `core.ts` (Appendix B:
 * reference resolution is exclusively this extension's concern; Core never
 * sees it). Reads the annotated `PositionedValue` tree Core produces and
 * performs the two-phase resolution the spec describes (§4), keeping every
 * intermediate result in the SAME annotated representation instead of a
 * separate raw-value tree with a bolted-on marker for "inert":
 *
 *   - A string's `quoted` flag (set once, by Core, from actual quote syntax)
 *     is the single source of truth for "never treat this as a reference
 *     site" — §2.3 (quoted tokens) and §3.8 (partial content) are the same
 *     rule applied to two different origins, so partial values are wrapped
 *     into this same representation with every string leaf pre-marked
 *     `quoted: true` before insertion (`partialToPositioned`), rather than
 *     needing a second, unrelated mechanism.
 *   - Every node keeps the source `line` it was parsed with, even after
 *     being deep-copied into a new position — diagnostics read it directly
 *     off the node instead of falling back to a coarser key-level lookup.
 *
 * There is no module-level mutable state: diagnostics are collected in a
 * `ResolutionContext` created fresh per call and threaded explicitly.
 */

import {
	type LimaValue, countNodes, canonicalString, codepointLength,
	ingestPartialValue, PARTIAL_COUNT_LIMIT, PARTIAL_NAME_LENGTH_LIMIT, PARTIAL_NODE_LIMIT,
	RESULT_NODE_LIMIT, SCALAR_LENGTH_LIMIT,
} from './value.js'
import {
	parseCoreWithPositions, toPlainValue, toNativeFromPositioned, NESTING_DEPTH_LIMIT,
	type PositionedValue, type Diagnostic, type InsertedAt, type NativeValue,
} from './core.js'
import { LimaError, type LimaDiagnostic } from './errors.js'

type Meta = Record<string, unknown>
const emptyMapping = (): Meta => Object.create(null)

// References §2.1/§2.2/Appendix B grammar, per sigil.
const DOC_SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*'
const DOC_PATH = `${DOC_SEGMENT}(?:\\.${DOC_SEGMENT})*`
const PARTIAL_KEY = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*'
const PURE_REF_RE = new RegExp(`^\\((?:\\$(${DOC_PATH})|%(${PARTIAL_KEY}))\\)$`)
const INTERP_RE = new RegExp(`\\((?:\\$(${DOC_PATH})|%(${PARTIAL_KEY}))\\)`, 'g')

// `line` is required (unlike LimaDiagnostic's optional `line`) — every
// diagnostic collected here comes from a specific source node during tree
// resolution, never from a document-less context like partial validation.
type ResolutionDiagnostic = LimaDiagnostic & { line: number }
type ResolutionContext = { best: ResolutionDiagnostic | null }

/**
 * §5: of every reference-resolution error encountered during a single
 * resolveTree pass, only the one at the lowest source line is ultimately
 * thrown. Tracking a running minimum instead of collecting every diagnostic
 * into an array and sorting it at the end avoids an O(e log e) sort (and
 * its allocations) for documents with many reference errors — `<` (not
 * `<=`) preserves the original stable-sort-then-take-first tie-break: the
 * first diagnostic reported at any given minimum line keeps winning over a
 * later one at the same line, exactly as it did when every one of them was
 * pushed into an array and stably sorted by line.
 */
const reportDiagnostic = (ctx: ResolutionContext, d: ResolutionDiagnostic): void => {
	if (ctx.best === null || d.line < ctx.best.line) ctx.best = d
}

// ─── PositionedValue-level helpers ─────────────────────────────────────────

const getNestedValueP = (root: Map<string, PositionedValue>, path: string): PositionedValue | undefined => {
	if (!path.includes('.')) return root.get(path)
	const parts = path.split('.')
	let cur: PositionedValue | undefined = root.get(parts[0])
	for (let i = 1; i < parts.length; i++) {
		if (cur === undefined || cur.kind !== 'mapping') return undefined
		cur = cur.entries.get(parts[i])
	}
	return cur
}

/**
 * `resolveTree` re-checks reference-freedom repeatedly on the SAME target
 * subtree — once per reference pointing at it (the fast-path guard at the
 * top of `resolveTree`, once more before copying a pure-reference target,
 * once more per interpolation match) — so a document with many references
 * into one large shared mapping would otherwise re-traverse that whole
 * subtree for every single reference. `PositionedValue` nodes are only ever
 * produced fresh (by Core, or by `deepCopyPositioned` below) and never
 * mutated in place, so object identity is a stable cache key for the
 * lifetime of a single `parseReferences` call — a module-level `WeakMap`
 * is safe (and self-cleaning: entries vanish once a parse's tree is
 * garbage-collected) rather than needing a per-call cache threaded through
 * every function.
 */
const referenceFreeCache = new WeakMap<PositionedValue, boolean>()

/**
 * A reference is only resolved from a target that is itself reference-free
 * (§4). Quoted strings are always free (§2.3); partial-derived values are
 * always free too, but never reach this function — see `partialToPositioned`.
 */
const isReferenceFreeP = (v: PositionedValue): boolean => {
	if (v.kind !== 'string' && v.kind !== 'array' && v.kind !== 'mapping') return true
	const cached = referenceFreeCache.get(v)
	if (cached !== undefined) return cached
	let result: boolean
	if (v.kind === 'string') {
		result = v.quoted || (!v.value.includes('($') && !v.value.includes('(%'))
	} else if (v.kind === 'array') {
		result = v.items.every(isReferenceFreeP)
	} else {
		result = true
		for (const c of v.entries.values()) if (!isReferenceFreeP(c)) { result = false; break }
	}
	referenceFreeCache.set(v, result)
	return result
}

/**
 * Structural deep copy for document-derived targets — preserves each leaf's
 * own line/quoted (§4.2/R-104: still eligible for further resolution) and
 * any existing `insertedAt` provenance from an earlier, nested resolution
 * (R-112: a reference copied wholesale into a new position can itself
 * already contain the result of an inner reference that resolved first —
 * both insertion sites remain identifiable participants after the copy).
 */
const deepCopyPositioned = (v: PositionedValue): PositionedValue => {
	switch (v.kind) {
		case 'array': return { kind: 'array', items: v.items.map(deepCopyPositioned), line: v.line, insertedAt: v.insertedAt }
		case 'mapping': {
			const entries = new Map<string, PositionedValue>()
			for (const [k, c] of v.entries) entries.set(k, deepCopyPositioned(c))
			return { kind: 'mapping', entries, line: v.line, insertedAt: v.insertedAt }
		}
		case 'instant': return { kind: 'instant', value: new Date(v.value.getTime()), line: v.line, insertedAt: v.insertedAt }
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
const partialToPositioned = (v: LimaValue, line: number): PositionedValue => {
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
 * Recursively resolves reference-shaped string leaves in `node` against
 * `lookup` — the single function both resolution phases share (§4.1's live
 * backward-reference pass and §4.2's snapshot-based forward pass differ
 * only in which `lookup` map and which source tree they're applied to, not
 * in the resolution logic itself). Errors are collected into `ctx`, never
 * thrown directly — see the module doc comment on error ordering.
 */
const resolveTree = (
	node: PositionedValue,
	lookup: Map<string, PositionedValue>,
	partials: Map<string, PositionedValue>,
	ctx: ResolutionContext,
): PositionedValue => {
	// Fast path: a subtree with no active reference-shaped string anywhere
	// inside it has nothing this function could change — skip rebuilding
	// it. Matters most for phase 2's redundant re-walk (see the module doc
	// comment) of a large already-resolved value, e.g. a big partial copied
	// in by several separate references: without this, every element gets
	// a fresh resolveTree call and every array/mapping level gets
	// reconstructed via .map()/a new Map on a pass that can only ever
	// return its input unchanged.
	if (node.kind !== 'string' && isReferenceFreeP(node)) return node
	if (node.kind === 'string') {
		if (node.quoted) return node
		const val = node.value

		// Pure reference: entire value is exactly one ($path) or (%key).
		if (val.charCodeAt(0) === 40 && val.charCodeAt(val.length - 1) === 41) {
			const m = val.match(PURE_REF_RE)
			if (m) {
				const isPartial = m[2] !== undefined
				const key = (isPartial ? m[2] : m[1])!
				// R-112: stamped on the copy's root only — descendants keep
				// whatever insertedAt they already carried from an earlier,
				// more deeply nested resolution (see deepCopyPositioned).
				const insertedAt: InsertedAt = { line: node.line, token: val }
				if (isPartial) {
					const target = partials.get(key)
					// §3.1 deep-copy requirement: `target` is the SAME cached tree
					// built once per partial name at ingestion (see
					// `partialToPositioned`'s call site) — every pure reference to
					// this partial anywhere in the document retrieves that one
					// tree. A shallow spread of its root would leave descendants
					// (including a mutable `Date` in an `instant` node) aliased
					// across every such reference; deep-copying here, exactly like
					// the document-reference branch below, is what actually
					// satisfies the guarantee.
					if (target !== undefined) return { ...deepCopyPositioned(target), insertedAt }
				} else {
					const target = getNestedValueP(lookup, key)
					if (target !== undefined && isReferenceFreeP(target)) {
						return { ...deepCopyPositioned(target), insertedAt }
					}
				}
				// Unresolved (or target not yet reference-free) — leave unchanged.
			}
		}

		// String interpolation: replace all ($path) / (%key) occurrences.
		if (val.includes('($') || val.includes('(%')) {
			const replaced = val.replace(INTERP_RE, (match, docPath, partialKey) => {
				const isPartial = partialKey !== undefined
				const key = isPartial ? partialKey : docPath
				const target = isPartial ? partials.get(key) : getNestedValueP(lookup, key)
				if (target === undefined || (!isPartial && !isReferenceFreeP(target))) return match
				if (target.kind === 'mapping') {
					reportDiagnostic(ctx, {
						code: 'INVALID_INTERPOLATION', line: node.line, token: match,
						message: `Lima: invalid interpolation of "${match}" at line ${node.line}: mapping cannot be interpolated into a string`,
					})
					return match
				}
				if (target.kind === 'array') {
					if (target.items.some((item) => item.kind === 'array' || item.kind === 'mapping')) {
						reportDiagnostic(ctx, {
							code: 'INVALID_INTERPOLATION', line: node.line, token: match,
							message: `Lima: invalid interpolation of "${match}" at line ${node.line}: array contains a nested array or mapping`,
						})
						return match
					}
					return target.items.map((item) => canonicalString(toPlainValue(item))).join(', ')
				}
				return canonicalString(toPlainValue(target))
			})
			// §6.2 final scalar-length limit: interpolation can grow a string
			// past the limit even when neither the raw document text nor the
			// interpolated target individually violated it — a hard error in
			// both modes, thrown immediately like the other resource limits
			// (never part of the ordered diagnostics set below).
			if (codepointLength(replaced) > SCALAR_LENGTH_LIMIT) {
				throw new LimaError({
					code: 'RESOURCE_LIMIT', line: node.line,
					message: `Lima: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${node.line}`,
				})
			}
			return { kind: 'string', value: replaced, line: node.line, quoted: false }
		}

		return node
	}

	if (node.kind === 'array') {
		return {
			kind: 'array',
			line: node.line,
			// Phase 2 redundantly re-walks values phase 1 already resolved
			// (harmless — see the module doc comment) — including, sometimes,
			// a node that phase 1 already stamped with insertedAt. Must be
			// carried over here, not just at the point of insertion, or a
			// reference's provenance silently disappears on the second pass.
			insertedAt: node.insertedAt,
			items: node.items.map((item) => {
				const resolved = resolveTree(item, lookup, partials, ctx)
				if (item.kind === 'string' && resolved.kind === 'array') {
					// References Appendix: array spreading was removed, and a
					// nested array produced by reference insertion violates
					// Core §7.2 (sequences contain scalars or mappings only) —
					// throws in BOTH modes (R-036/R-143).
					reportDiagnostic(ctx, {
						code: 'INVALID_REFERENCE_SHAPE', line: item.line, token: item.value,
						message: `Lima: reference "${item.value}" resolves to an array, which cannot be inserted as a sequence item at line ${item.line}`,
					})
					return item
				}
				return resolved
			}),
		}
	}

	if (node.kind === 'mapping') {
		const entries = new Map<string, PositionedValue>()
		for (const [k, c] of node.entries) entries.set(k, resolveTree(c, lookup, partials, ctx))
		return { kind: 'mapping', entries, line: node.line, insertedAt: node.insertedAt }
	}

	return node // null/bool/int/float/instant — nothing to resolve
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
type FinalizedValue = { native: NativeValue; nodeCount: number; depth: number; deepestParticipants: InsertedAt[] }

const finalizePositioned = (v: PositionedValue): FinalizedValue => {
	const own = v.insertedAt ? [v.insertedAt] : []
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

/** Earliest (lowest-line) participant, or null when none exist — R-113's "line 1" fallback applies then. */
const earliestParticipant = (participants: InsertedAt[]): InsertedAt | null =>
	participants.length === 0 ? null : participants.reduce((a, b) => (b.line < a.line ? b : a))

/** Node-count attribution for the RESOURCE_LIMIT error path: every reference insertion anywhere in the tree contributes to the total. */
const collectAllParticipants = (v: PositionedValue, acc: InsertedAt[]): void => {
	if (v.insertedAt) acc.push(v.insertedAt)
	if (v.kind === 'array') for (const item of v.items) collectAllParticipants(item, acc)
	if (v.kind === 'mapping') for (const c of v.entries.values()) collectAllParticipants(c, acc)
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type ReferencesOptions = {
	/** Named values available via `(%key)` references. */
	partials?: Meta
	strict?: boolean
	/** Core §11.2 (inherited): callback for non-strict warnings (e.g. duplicate keys). Discarded if omitted. */
	onWarning?: (diagnostic: Diagnostic) => void
}

export const parseReferences = <T extends Record<string, unknown> = Meta>(
	frontMatter: string,
	options?: ReferencesOptions,
): T => {
	const strict = options?.strict ?? false
	const rawPartials = options?.partials ?? {}

	// §6.2 / R-114: partials are validated and deep-copied before document
	// parsing begins — this must run even for an empty document. Partial
	// errors carry a value path, never a document line (parsing hasn't
	// started), so they throw directly rather than joining the ordered
	// diagnostics collected below.
	const partialNames = Object.keys(rawPartials)
	if (partialNames.length > PARTIAL_COUNT_LIMIT) {
		throw new LimaError({ code: 'INVALID_PARTIAL', message: `Lima: too many partials (max ${PARTIAL_COUNT_LIMIT})` })
	}
	for (const name of partialNames) {
		if (codepointLength(name) > PARTIAL_NAME_LENGTH_LIMIT) {
			throw new LimaError({
				code: 'INVALID_PARTIAL', partial: name, path: name,
				message: `Lima: invalid partial "${name}" at path "${name}": name exceeds maximum length of ${PARTIAL_NAME_LENGTH_LIMIT} code points`,
			})
		}
	}
	const partials = new Map<string, LimaValue>()
	for (const [name, value] of Object.entries(rawPartials)) {
		partials.set(name, ingestPartialValue(value, name, name))
	}
	let totalPartialNodes = 0
	for (const v of partials.values()) totalPartialNodes += countNodes(v)
	if (totalPartialNodes > PARTIAL_NODE_LIMIT) {
		throw new LimaError({
			code: 'INVALID_PARTIAL',
			message: `Lima: partials exceed the combined maximum of ${PARTIAL_NODE_LIMIT} value nodes`,
		})
	}

	// Converted to the annotated representation once per partial, not once
	// per reference: nothing downstream ever mutates a PositionedValue tree
	// in place (resolveTree's fast path returns inert subtrees unchanged;
	// toNativeFromPositioned always allocates fresh native containers for
	// the public result), so every reference to the same partial can safely
	// reuse the same body and only needs its own `insertedAt` stamped onto
	// a shallow copy of the root — no per-reference deep copy required. The
	// internal `line` on partial-derived nodes is never read downstream
	// (every diagnostic that could involve one uses the referencing site's
	// own line instead), so the placeholder `0` here is fine.
	const partialsPositioned = new Map<string, PositionedValue>()
	for (const [name, value] of partials) partialsPositioned.set(name, partialToPositioned(value, 0))

	const root = parseCoreWithPositions(frontMatter, { strict, onWarning: options?.onWarning })
	const ctx: ResolutionContext = { best: null }

	const hasRefs = frontMatter.includes('($') || frontMatter.includes('(%')
	let finalMap: Map<string, PositionedValue>

	if (!hasRefs) {
		finalMap = root
	} else {
		// Phase 1 (§4.1): resolve each top-level key's value in document
		// order against a live, growing snapshot of already-processed keys
		// — reproduces backward-reference resolution without needing a
		// second pass for the common case.
		const phase1Live = new Map<string, PositionedValue>()
		// §3.7/§4 one-hop limit: a top-level key whose OWN inline value was
		// itself a pure reference token must never be usable as another
		// key's hop target via its (possibly already-resolved) live value —
		// only its original token text is a valid phase-2 lookup target, so
		// a chain a→b→c can never fully resolve regardless of where c
		// happens to be written relative to b (§4: independent of mapping
		// enumeration order).
		const originalPureRefText = new Map<string, string>()
		for (const [key, node] of root) {
			if (node.kind === 'string' && !node.quoted && PURE_REF_RE.test(node.value)) {
				originalPureRefText.set(key, node.value)
			}
			phase1Live.set(key, resolveTree(node, phase1Live, partialsPositioned, ctx))
		}

		// Phase 2 (§4.2): re-resolve every key's phase-1 value — this is
		// what catches forward references — against a snapshot that is
		// immutable for the whole phase (a plain reference to a Map built
		// once above, no cloning needed: nothing here mutates it).
		const phase1Snapshot = new Map<string, PositionedValue>()
		for (const [key, value] of phase1Live) {
			phase1Snapshot.set(key, originalPureRefText.has(key)
				? { kind: 'string', value: originalPureRefText.get(key)!, line: root.get(key)!.line, quoted: false }
				: value)
		}

		finalMap = new Map<string, PositionedValue>()
		for (const [key] of root) {
			finalMap.set(key, resolveTree(phase1Live.get(key)!, phase1Snapshot, partialsPositioned, ctx))
		}
	}

	// Strict mode: collect every reference still unresolved after both
	// phases. Each leaf reports its OWN line — every node in this tree
	// carries one from the moment Core parsed it, so no separate
	// provenance-tracking pass is needed to attribute this precisely.
	if (strict) {
		const scanUnresolved = (v: PositionedValue): void => {
			if (v.kind === 'string') {
				if (!v.quoted && (v.value.includes('($') || v.value.includes('(%'))) {
					const m = v.value.match(/\(([%$])([^)]+)\)/)
					if (m) {
						reportDiagnostic(ctx, {
							code: 'UNRESOLVED_REFERENCE', line: v.line, token: `(${m[1]}${m[2]})`,
							message: `Lima: unresolved reference "(${m[1]}${m[2]})" at line ${v.line}`,
						})
					}
				}
				return
			}
			if (v.kind === 'array') { for (const item of v.items) scanUnresolved(item); return }
			if (v.kind === 'mapping') { for (const c of v.entries.values()) scanUnresolved(c); return }
		}
		for (const v of finalMap.values()) scanUnresolved(v)
	}

	// §5: of every reference-resolution error collected above, the one at
	// the lowest source line is thrown; the rest are discarded.
	if (ctx.best !== null) {
		throw new LimaError(ctx.best)
	}

	// Depth (Core §9, re-checked on the final POST-substitution tree —
	// inserted values can add depth Core's own pre-resolution check inside
	// parseCoreWithPositions could not see yet), node count (§6.2), and the
	// native result itself all come out of one pass over `finalMap` — see
	// finalizePositioned's doc comment for why this replaces three
	// independent full-tree walks.
	const finalResults: [string, FinalizedValue][] = []
	for (const [k, v] of finalMap) finalResults.push([k, finalizePositioned(v)])

	// References §5/R-112: attributed to the lowest-line reference token
	// among the insertions on the actual deepest path, or line 1 (R-113)
	// when the excess depth came entirely from literal, non-reference
	// content.
	const depth = finalResults.length === 0 ? 0 : Math.max(...finalResults.map(([, r]) => r.depth))
	if (depth > NESTING_DEPTH_LIMIT) {
		const participants = finalResults.filter(([, r]) => r.depth === depth).flatMap(([, r]) => r.deepestParticipants)
		const winner = earliestParticipant(participants)
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: winner?.line ?? 1, token: winner?.token,
			message: winner
				? `Lima: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line ${winner.line}: "${winner.token}"`
				: `Lima: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1`,
		})
	}

	// §6.2: total node count of the final result tree, both modes. Same
	// R-112 attribution — every reference insertion anywhere in the tree
	// contributes to the total, so the lowest-line one is reported.
	let totalResultNodes = 1 // the root mapping itself counts as one node
	for (const [, r] of finalResults) totalResultNodes += r.nodeCount
	if (totalResultNodes > RESULT_NODE_LIMIT) {
		const participants: InsertedAt[] = []
		for (const v of finalMap.values()) collectAllParticipants(v, participants)
		const winner = earliestParticipant(participants)
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: winner?.line ?? 1, token: winner?.token,
			message: winner
				? `Lima: result exceeds maximum size of ${RESULT_NODE_LIMIT} total nodes at line ${winner.line}: "${winner.token}"`
				: `Lima: result exceeds maximum size of ${RESULT_NODE_LIMIT} total nodes at line 1`,
		})
	}

	const out = emptyMapping()
	for (const [k, r] of finalResults) out[k] = r.native
	return out as unknown as T
}

/** Backward-compatible primary entry point — References layered on Core. */
export const parse = parseReferences
export type ParseOptions = ReferencesOptions
