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
 *
 * The grammar itself lives in `normalize.ts` (shared context/limits),
 * `scalars.ts` (dates, numbers, quoting, the `PositionedValue` tree type),
 * `flow.ts` (`[...]`/`{...}`), and `block.ts` (indentation-based sequences
 * and mappings) — this file is the orchestrator that ties them together.
 */

import { type LimaValue, LString } from './value.js'
import {
	type ParseContext, type Diagnostic, checkKeyLength, checkScalarLimit, byteLength,
	DOCUMENT_SIZE_LIMIT, TOP_LEVEL_KEY_LIMIT, NESTING_DEPTH_LIMIT,
} from './normalize.js'
import {
	type PositionedValue, unescapeDQ, stripComment, parseScalarValue, positionedBuilder,
} from './scalars.js'
import { parseFlowSequence, parseFlowMapping } from './flow.js'
import { parseBlock } from './block.js'
import { LimaError, type LimaDiagnostic } from './errors.js'
import { scanKeys } from './scanner.js'
import type { ValueBuilder } from './builder.js'

export type { Diagnostic, ParseContext } from './normalize.js'
export { NESTING_DEPTH_LIMIT, SCALAR_LENGTH_LIMIT } from './normalize.js'
export type { PositionedValue, InsertedAt } from './scalars.js'
export { toPlainValue } from './scalars.js'

type Meta = Record<string, unknown>

/** Every Lima mapping result must be a prototype-free object (Core §11.1). */
const emptyMapping = (): Meta => Object.create(null)

const depthOfPositioned = (v: PositionedValue): number => {
	if (v.kind === 'array') return v.items.length === 0 ? 1 : 1 + Math.max(...v.items.map(depthOfPositioned))
	if (v.kind === 'mapping') {
		const children = [...v.entries.values()]
		return children.length === 0 ? 1 : 1 + Math.max(...children.map(depthOfPositioned))
	}
	return 0
}

/**
 * Same Core §9 depth measurement as `depthOfPositioned`, but over the
 * untagged native representation `parseCore`'s fast path builds directly —
 * no `.kind` to switch on, so containers are recognised structurally:
 * `Array.isArray` for a sequence, else any non-`Date` object for a mapping
 * (a `Date` is the one native object type that's a scalar leaf, not a
 * container).
 */
const depthOfNative = (v: NativeValue): number => {
	if (Array.isArray(v)) return v.length === 0 ? 1 : 1 + Math.max(...v.map(depthOfNative))
	if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
		const children = Object.values(v)
		return children.length === 0 ? 1 : 1 + Math.max(...children.map(depthOfNative))
	}
	return 0
}

const SPACE_BEFORE_COLON_RE = /^(?:'[^']*'|"(?:[^"\\]|\\.)*")[ \t]+:/

const leadingSpaces = (line: string): number => {
	let i = 0
	while (i < line.length && line.charCodeAt(i) === 32) i++
	return i
}

/** Index right after the last non-space character — the `trimEnd()` boundary, without allocating. */
const trailingSpaceEnd = (line: string): number => {
	let i = line.length
	while (i > 0 && line.charCodeAt(i - 1) === 32) i--
	return i
}

const lineAt = (s: string, pos: number): number => {
	let n = 1
	for (let i = 0; i < pos; i++) if (s.charCodeAt(i) === 10) n++
	return n
}

export type CoreOptions = {
	strict?: boolean
	/** Core §11.2: callback for non-strict warnings (e.g. duplicate keys). Discarded if omitted. */
	onWarning?: (diagnostic: Diagnostic) => void
}

/**
 * Parses LIMA Core 1.0 syntax, generic over the output representation
 * (`builder` — see `builder.ts`): References needs the annotated
 * `PositionedValue` tree (`parseCoreWithPositions` below fixes `V` to
 * that), while `parseCore` fixes `V` to the public native shape directly,
 * skipping the annotated tree — and the extra full-tree conversion pass
 * out of it — entirely. One shared control flow either way, so the two
 * never drift apart the way a hand-copied second parser could.
 * `computeDepth` is similarly representation-specific (Core §9's
 * pre-resolution nesting-depth check, run once here regardless of `V`):
 * `depthOfPositioned` inspects a tagged union's `.kind`; `depthOfNative`
 * inspects the untagged native shape structurally instead.
 */
const parseCoreGeneric = <V, M>(
	frontMatter: string, ctx: ParseContext, builder: ValueBuilder<V, M>, computeDepth: (v: V) => number,
): M => {
	const { strict } = ctx
	if (byteLength(frontMatter) > DOCUMENT_SIZE_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: 1,
			message: `LIMA: document exceeds maximum size of ${DOCUMENT_SIZE_LIMIT} bytes at line 1`,
		})
	}

	const root = builder.createMapping()
	if (!frontMatter) return root

	// Each of these three passes is skipped outright when a cheap upfront
	// check proves it would be a no-op — a full-document regex `.replace()`
	// always allocates a new string even when nothing actually changes, and
	// real documents are overwhelmingly already LF-only, space-indented,
	// and free of trailing whitespace (git normalizes line endings, most
	// editors strip trailing whitespace on save). Each guard is sound (a
	// negative guard never skips a pass that would have changed something):
	// checked sequentially against the already-updated string, so e.g. the
	// trailing-space guard correctly sees spaces the tab-expansion pass
	// itself just created (an all-tab blank line expands to an all-space
	// line, which then still needs trimming).
	if (frontMatter.includes('\r')) frontMatter = frontMatter.replace(/\r\n|\r/g, '\n')
	if (frontMatter.includes('\t')) {
		frontMatter = frontMatter.replace(/^([ \t]*)/gm, (leading) => (leading.includes('\t') ? leading.replace(/\t/g, '  ') : leading))
	}
	if (frontMatter.includes(' \n') || frontMatter.endsWith(' ')) {
		// Capture-and-reinsert instead of a lookahead: `( +)(\n|$)` replaced
		// with just group 2 removes the spaces and puts back whatever
		// followed them (a newline, or nothing at end of string) — same
		// result as ` +(?=\n|$)` → '', without relying on a construct RE2
		// (and RE2-family engines like Rust's `regex` crate) don't support.
		frontMatter = frontMatter.replace(/( +)(\n|$)/gm, '$2')
	}

	const matches  = scanKeys(frontMatter)
	const keyCount = matches.length

	const keyLine = (i: number): number => matches[i].line

	if (strict) {
		let searchFrom = 0
		while (searchFrom <= frontMatter.length) {
			const lineEnd = frontMatter.indexOf('\n', searchFrom)
			const line = lineEnd === -1 ? frontMatter.slice(searchFrom) : frontMatter.slice(searchFrom, lineEnd)
			if (SPACE_BEFORE_COLON_RE.test(line)) {
				throw new LimaError({
					code: 'INVALID_QUOTE', line: lineAt(frontMatter, searchFrom),
					message: `LIMA: space between closing quote and colon at line ${lineAt(frontMatter, searchFrom)}`,
				})
			}
			if (lineEnd === -1) break
			searchFrom = lineEnd + 1
		}
	}

	if (keyCount === 0) return root

	if (keyCount > TOP_LEVEL_KEY_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: 1,
			message: `LIMA: too many top-level key entries (max ${TOP_LEVEL_KEY_LIMIT}) at line 1`,
		})
	}

	for (let i = 0; i < keyCount; i++) {
		const m     = matches[i]
		const rawDQ = m.doubleQuotedRaw
		const key   = m.unquoted ?? m.singleQuoted ?? (rawDQ !== undefined ? unescapeDQ(rawDQ) : undefined)
		if (key === undefined) continue
		checkKeyLength(key, () => keyLine(i))

		if (builder.hasMappingKey(root, key)) {
			const line = keyLine(i)
			const diagnostic = {
				code: 'DUPLICATE_KEY', line, key,
				message: `LIMA: duplicate key "${key}" at line ${line} — last value wins`,
			} satisfies LimaDiagnostic
			if (strict) throw new LimaError(diagnostic)
			// Public `Diagnostic` type is spec-frozen {message, line} (§11.2);
			// see normalize.ts's checkDuplicateKeyMap for why the richer
			// object is delivered anyway.
			ctx.onWarning?.(diagnostic)
		}

		const nextStart = i + 1 < matches.length ? matches[i + 1].matchStart : frontMatter.length
		const raw       = frontMatter.slice(m.rawStart, nextStart)
		const isBlock   = m.isBlock
		const firstNewline = raw.indexOf('\n')

		// Typical frontmatter uses one inline scalar per key. Avoid building
		// and filling a temporary lines array for that overwhelmingly common
		// case; the scanner-delimited raw slice contains at most its terminal
		// newline here.
		if (!isBlock && (firstNewline === -1 || firstNewline === raw.length - 1)) {
			const val = firstNewline === -1 ? raw : raw.slice(0, -1)
			const line = m.line
			const uncommented = val.includes('#') ? stripComment(val) : val
			const flowSeq = parseFlowSequence(uncommented, ctx, line, builder)
			if (flowSeq !== null) {
				builder.setMapping(root, key, builder.array(flowSeq, line))
			} else {
				const flowMap = parseFlowMapping(uncommented, ctx, line, builder)
				builder.setMapping(root, key, flowMap !== null ? flowMap : parseScalarValue(uncommented, ctx, line, builder))
			}
			continue
		}

		const lines: string[] = []
		let lineStart = 0
		for (let j = 0; j <= raw.length; j++) {
			if (j === raw.length || raw.charCodeAt(j) === 10) {
				if (j > lineStart) lines.push(raw.slice(lineStart, j))
				lineStart = j + 1
			}
		}

		if (isBlock) {
			let firstNonEmpty = 0
			while (firstNonEmpty < lines.length && !lines[firstNonEmpty].trim()) firstNonEmpty++
			const baseIndent = firstNonEmpty < lines.length ? leadingSpaces(lines[firstNonEmpty]) : 0
			const parsed = parseBlock(lines, 0, baseIndent, ctx, keyLine(i) + 1, builder).value
			builder.setMapping(root, key, parsed ?? builder.null(keyLine(i)))
		} else {
			if (lines.length === 0) {
				builder.setMapping(root, key, builder.null(keyLine(i)))
				continue
			}

			const line0Trimmed = lines[0].trim()
			if (lines.length === 1 || line0Trimmed !== '|') {
				const line0 = lines[0]
				const val   = line0.includes('#') ? stripComment(line0) : line0
				const flowSeq = parseFlowSequence(val, ctx, keyLine(i), builder)
				if (flowSeq !== null) {
					builder.setMapping(root, key, builder.array(flowSeq, keyLine(i)))
				} else {
					const flowMap = parseFlowMapping(val, ctx, keyLine(i), builder)
					builder.setMapping(root, key, flowMap !== null ? flowMap : parseScalarValue(val, ctx, keyLine(i), builder))
				}
				continue
			}

			// Multi-line string (`|` literal block scalar).
			const bodyLines = raw.slice(raw.indexOf('\n') + 1).split('\n')

			// Avoids trim()/trimStart()/trimEnd() — each allocates a whole new
			// string just to measure or strip whitespace. leadingSpaces/
			// trailingSpaceEnd compute the same boundaries by scanning char
			// codes, and dedent+continuation-strip+trailing-trim collapse
			// into a single final slice() per line instead of up to three.
			let minIndent = Infinity
			for (const bodyLine of bodyLines) {
				const indent = leadingSpaces(bodyLine)
				if (indent === bodyLine.length) continue // blank (all spaces, or empty)
				if (indent < minIndent) minIndent = indent
			}
			minIndent = Math.min(minIndent, key.length + 2)
			const trimAmt = minIndent > 1 && isFinite(minIndent) ? minIndent : 0

			const mergedLines: string[] = []
			for (const bodyLine of bodyLines) {
				const lineLen = bodyLine.length
				let start = trimAmt < lineLen ? trimAmt : lineLen
				const isContinuation = bodyLine.charCodeAt(start) === 94 && bodyLine.charCodeAt(start + 1) === 94 // ^^
				if (isContinuation) start += 2
				let end = trailingSpaceEnd(bodyLine)
				if (end < start) end = start
				const content = bodyLine.slice(start, end)
				if (isContinuation) {
					if (mergedLines.length > 0) {
						if (content) mergedLines[mergedLines.length - 1] += ' ' + content
					} else {
						mergedLines.push(content)
					}
				} else {
					mergedLines.push(content)
				}
			}

			while (mergedLines.length > 0 && mergedLines[mergedLines.length - 1] === '') mergedLines.pop()

			const joined = mergedLines.join('\n')
			checkScalarLimit(LString(joined), keyLine(i))
			builder.setMapping(root, key, builder.string(joined, keyLine(i), false))
		}
	}

	// Core §9 nesting depth, over Core's own reference-inert tree. When
	// References is layered on top, it re-checks depth on the final,
	// post-substitution tree separately — substituted values can add depth
	// this check cannot see yet.
	const rootValues = [...builder.mappingValues(root)]
	const depth = rootValues.length === 0 ? 0 : Math.max(...rootValues.map(computeDepth))
	if (depth > NESTING_DEPTH_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: 1,
			message: `LIMA: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1`,
		})
	}

	return root
}

/**
 * Parses LIMA Core 1.0 syntax into the internal annotated value tree —
 * every node carrying its source line, string leaves additionally carrying
 * whether they came from quoted syntax. `($key)`/`(%key)` text is left
 * exactly as written; nothing here ever inspects or resolves it. The
 * primitive the References layer (`references.ts`) builds on.
 */
export const parseCoreWithPositions = (frontMatter: string, ctx: ParseContext): Map<string, PositionedValue> =>
	parseCoreGeneric(frontMatter, ctx, positionedBuilder, depthOfPositioned)

/** The public result shape (Core §11.1): every value `toNative*` can produce. */
export type NativeValue =
	| null | boolean | number | string | Date
	| NativeValue[]
	| { [key: string]: NativeValue }

/**
 * The `ValueBuilder<NativeValue>` — `parseCore`'s fast path. Every scalar
 * builder is the identity function: unlike `positionedBuilder`, there is no
 * wrapper object to allocate at all, only the value itself. `array` and
 * `mapping` build the exact public shape directly (a real array; a
 * prototype-free object per Core §11.1), so `parseCore` never needs a
 * separate conversion pass over an intermediate tree afterward.
 */
export const nativeBuilder: ValueBuilder<NativeValue, Record<string, NativeValue>> = {
	null: () => null,
	bool: (value) => value,
	int: (value) => value,
	float: (value) => value,
	string: (value) => value,
	instant: (value) => value,
	array: (items) => items,
	// A fresh, still-empty prototype-free object trivially satisfies any
	// record type — the one honest, narrow cast this builder needs, versus
	// the unwrap-an-opaque-`unknown`-and-hope casts the `unknown`-typed
	// interface required at every method below.
	createMapping: () => emptyMapping() as Record<string, NativeValue>,
	hasMappingKey: (entries, key) => Object.prototype.hasOwnProperty.call(entries, key),
	setMapping: (entries, key, value) => { entries[key] = value },
	mappingValues: (entries) => Object.values(entries),
	mapping: (entries) => entries,
}

/** Converts a Lima value to a plain, native JS value (the public result shape). */
export const toNative = (v: LimaValue): NativeValue => {
	switch (v.kind) {
		case 'null': return null
		case 'bool': return v.value
		case 'int': case 'float': return v.value
		case 'string': return v.value
		case 'instant': return v.value
		case 'array': return v.items.map(toNative)
		case 'mapping': {
			const out = emptyMapping()
			for (const [k, c] of v.entries) out[k] = toNative(c)
			return out as NativeValue
		}
	}
}

/**
 * `toNative(toPlainValue(v))` in one pass instead of two full tree walks —
 * matters most for large, reference-expanded results (many copies of a
 * sizeable partial), where the position/quoted-stripping pass and the
 * native-conversion pass would otherwise each independently visit every
 * node of the same, potentially large, final tree.
 */
export const toNativeFromPositioned = (v: PositionedValue): NativeValue => {
	switch (v.kind) {
		case 'null': return null
		case 'bool': return v.value
		case 'int': case 'float': return v.value
		case 'string': return v.value
		case 'instant': return v.value
		case 'array': return v.items.map(toNativeFromPositioned)
		case 'mapping': {
			const out = emptyMapping()
			for (const [k, c] of v.entries) out[k] = toNativeFromPositioned(c)
			return out as NativeValue
		}
	}
}

/**
 * Public Core 1.0 entry point. Never resolves `($key)`/`(%key)` text — see
 * the module doc comment. Equivalent in observable behavior to calling
 * `parseReferences()` with no partials on a document that happens to
 * contain no references, except that here reference-shaped text is
 * guaranteed to always pass through unresolved, even in strict mode.
 */
export const parseCore = <T extends Record<string, unknown> = Meta>(
	frontMatter: string, options?: CoreOptions
): T => {
	const ctx: ParseContext = { strict: options?.strict ?? false, onWarning: options?.onWarning }
	return parseCoreGeneric(frontMatter, ctx, nativeBuilder, depthOfNative) as T
}
