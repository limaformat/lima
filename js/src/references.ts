/**
 * LIMA References 1.0 — layered strictly on top of `core.ts` (Appendix B:
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
	type LimaValue, LMapping, countNodes, canonicalString,
	ingestPartialValue, PARTIAL_COUNT_LIMIT, PARTIAL_NAME_LENGTH_LIMIT, PARTIAL_NODE_LIMIT,
	RESULT_NODE_LIMIT, SCALAR_LENGTH_LIMIT,
} from './value'
import {
	parseCoreWithPositions, toPlainValue, toNative, NESTING_DEPTH_LIMIT,
	type PositionedValue, type Diagnostic, type InsertedAt,
} from './core'

type Meta = Record<string, any>
const emptyMapping = (): Meta => Object.create(null)

// References §2.1/§2.2/Appendix B grammar, per sigil.
const DOC_SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*'
const DOC_PATH = `${DOC_SEGMENT}(?:\\.${DOC_SEGMENT})*`
const PARTIAL_KEY = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*'
const PURE_REF_RE = new RegExp(`^\\((?:\\$(${DOC_PATH})|%(${PARTIAL_KEY}))\\)$`)
const INTERP_RE = new RegExp(`\\((?:\\$(${DOC_PATH})|%(${PARTIAL_KEY}))\\)`, 'g')

type ResolutionContext = { diagnostics: { line: number; message: string }[] }

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
 * A reference is only resolved from a target that is itself reference-free
 * (§4). Quoted strings are always free (§2.3); partial-derived values are
 * always free too, but never reach this function — see `partialToPositioned`.
 */
const isReferenceFreeP = (v: PositionedValue): boolean => {
	if (v.kind === 'string') return v.quoted || (!v.value.includes('($') && !v.value.includes('(%'))
	if (v.kind === 'array') return v.items.every(isReferenceFreeP)
	if (v.kind === 'mapping') {
		for (const c of v.entries.values()) if (!isReferenceFreeP(c)) return false
		return true
	}
	return true
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
 * reference-like substring inside partial content). Freshly constructs the
 * whole subtree on every call, so multiple references to the same partial
 * never alias (§6.2 deep-copy requirement is satisfied as a side effect).
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
	partials: Map<string, LimaValue>,
	ctx: ResolutionContext,
): PositionedValue => {
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
					if (target !== undefined) return { ...partialToPositioned(target, node.line), insertedAt }
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
				const rawTarget = isPartial ? partials.get(key) : undefined
				const target = isPartial
					? (rawTarget !== undefined ? partialToPositioned(rawTarget, node.line) : undefined)
					: getNestedValueP(lookup, key)
				if (target === undefined || (!isPartial && !isReferenceFreeP(target))) return match
				if (target.kind === 'mapping') {
					ctx.diagnostics.push({
						line: node.line,
						message: `LIMA: invalid interpolation of "${match}" at line ${node.line}: mapping cannot be interpolated into a string`,
					})
					return match
				}
				if (target.kind === 'array') {
					if (target.items.some((item) => item.kind === 'array' || item.kind === 'mapping')) {
						ctx.diagnostics.push({
							line: node.line,
							message: `LIMA: invalid interpolation of "${match}" at line ${node.line}: array contains a nested array or mapping`,
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
			if ([...replaced].length > SCALAR_LENGTH_LIMIT) {
				throw new Error(`LIMA: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${node.line}`)
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
					ctx.diagnostics.push({
						line: item.line,
						message: `LIMA: reference "${item.value}" resolves to an array, which cannot be inserted as a sequence item at line ${item.line}`,
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
 * References §5/R-112: nesting-depth attribution needs more than a depth
 * number — it needs to know which reference insertions lie on the actual
 * deepest path, so the earliest of those (by line) can be blamed. Ties for
 * "deepest child" all count: a violation can be reached via more than one
 * maximal-depth branch, and every reference insertion along any of them is
 * a genuine participant.
 */
type DepthResult = { depth: number; participants: InsertedAt[] }

const depthWithProvenance = (v: PositionedValue): DepthResult => {
	const own = v.insertedAt ? [v.insertedAt] : []
	if (v.kind === 'array' || v.kind === 'mapping') {
		const children = v.kind === 'array' ? v.items : [...v.entries.values()]
		if (children.length === 0) return { depth: 1, participants: own }
		const results = children.map(depthWithProvenance)
		const maxDepth = Math.max(...results.map((r) => r.depth))
		const deepestParticipants = results.filter((r) => r.depth === maxDepth).flatMap((r) => r.participants)
		return { depth: 1 + maxDepth, participants: [...own, ...deepestParticipants] }
	}
	return { depth: 0, participants: own }
}

/** Earliest (lowest-line) participant, or null when none exist — R-113's "line 1" fallback applies then. */
const earliestParticipant = (participants: InsertedAt[]): InsertedAt | null =>
	participants.length === 0 ? null : participants.reduce((a, b) => (b.line < a.line ? b : a))

/** Node-count attribution: every reference insertion anywhere in the tree contributes to the total. */
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
		throw new Error(`LIMA: too many partials (max ${PARTIAL_COUNT_LIMIT})`)
	}
	for (const name of partialNames) {
		if ([...name].length > PARTIAL_NAME_LENGTH_LIMIT) {
			throw new Error(`LIMA: invalid partial "${name}" at path "${name}": name exceeds maximum length of ${PARTIAL_NAME_LENGTH_LIMIT} code points`)
		}
	}
	const partials = new Map<string, LimaValue>()
	for (const [name, value] of Object.entries(rawPartials)) {
		partials.set(name, ingestPartialValue(value, name, name))
	}
	let totalPartialNodes = 0
	for (const v of partials.values()) totalPartialNodes += countNodes(v)
	if (totalPartialNodes > PARTIAL_NODE_LIMIT) {
		throw new Error(`LIMA: partials exceed the combined maximum of ${PARTIAL_NODE_LIMIT} value nodes`)
	}

	const root = parseCoreWithPositions(frontMatter, { strict, onWarning: options?.onWarning })
	const ctx: ResolutionContext = { diagnostics: [] }

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
			phase1Live.set(key, resolveTree(node, phase1Live, partials, ctx))
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
			finalMap.set(key, resolveTree(phase1Live.get(key)!, phase1Snapshot, partials, ctx))
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
						ctx.diagnostics.push({ line: v.line, message: `LIMA: unresolved reference "(${m[1]}${m[2]})" at line ${v.line}` })
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
	if (ctx.diagnostics.length > 0) {
		ctx.diagnostics.sort((a, b) => a.line - b.line)
		throw new Error(ctx.diagnostics[0].message)
	}

	// Core §9 nesting depth, re-checked on the final POST-substitution tree
	// — inserted values can add depth Core's own pre-resolution check
	// (inside parseCoreWithPositions) could not see yet. References §5/
	// R-112: attributed to the lowest-line reference token among the
	// insertions on the actual deepest path, or line 1 (R-113) when the
	// excess depth came entirely from literal, non-reference content.
	const finalValues = [...finalMap.values()]
	const depthResults = finalValues.map(depthWithProvenance)
	const depth = depthResults.length === 0 ? 0 : Math.max(...depthResults.map((r) => r.depth))
	if (depth > NESTING_DEPTH_LIMIT) {
		const participants = depthResults.filter((r) => r.depth === depth).flatMap((r) => r.participants)
		const winner = earliestParticipant(participants)
		throw new Error(winner
			? `LIMA: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line ${winner.line}: "${winner.token}"`
			: `LIMA: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1`)
	}

	// §6.2: total node count of the final result tree, both modes. Same
	// R-112 attribution — every reference insertion anywhere in the tree
	// contributes to the total, so the lowest-line one is reported.
	const finalEntries = new Map<string, LimaValue>()
	for (const [k, v] of finalMap) finalEntries.set(k, toPlainValue(v))
	const totalResultNodes = countNodes(LMapping(finalEntries))
	if (totalResultNodes > RESULT_NODE_LIMIT) {
		const participants: InsertedAt[] = []
		for (const v of finalMap.values()) collectAllParticipants(v, participants)
		const winner = earliestParticipant(participants)
		throw new Error(winner
			? `LIMA: result exceeds maximum size of ${RESULT_NODE_LIMIT} total nodes at line ${winner.line}: "${winner.token}"`
			: `LIMA: result exceeds maximum size of ${RESULT_NODE_LIMIT} total nodes at line 1`)
	}

	const out = emptyMapping()
	for (const [k, v] of finalEntries) out[k] = toNative(v)
	return out as unknown as T
}

/** Backward-compatible primary entry point — References layered on Core. */
export const parse = parseReferences
export type ParseOptions = ReferencesOptions
