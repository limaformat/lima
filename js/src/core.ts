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
	type PositionedValue, unescapeDQ, stripComment, parseScalarValue,
} from './scalars.js'
import { parseFlowSequence, parseFlowMapping } from './flow.js'
import { parseBlock } from './block.js'
import { LimaError, type LimaDiagnostic } from './errors.js'

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

// See the historical implementation notes carried over from the legacy
// parser: ASCII-only key grammar (frontmatter keys are always ASCII),
// \r/\t excluded from the separator group because parse() normalizes first.
const KEY_RE = /^(?:([a-zA-Z\d_][a-zA-Z\d_:-]*)|'([^']*)'|"((?:[^"\\]|\\.)*)"):( *\n| )/gm
const SPACE_BEFORE_COLON_RE = /^(?:'[^']*'|"(?:[^"\\]|\\.)*")[ \t]+:/

const leadingSpaces = (line: string): number => {
	let i = 0
	while (i < line.length && line.charCodeAt(i) === 32) i++
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
 * Parses LIMA Core 1.0 syntax into the internal annotated value tree —
 * every node carrying its source line, string leaves additionally carrying
 * whether they came from quoted syntax. `($key)`/`(%key)` text is left
 * exactly as written; nothing here ever inspects or resolves it.
 */
export const parseCoreWithPositions = (frontMatter: string, ctx: ParseContext): Map<string, PositionedValue> => {
	const { strict } = ctx
	if (byteLength(frontMatter) > DOCUMENT_SIZE_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: 1,
			message: `LIMA: document exceeds maximum size of ${DOCUMENT_SIZE_LIMIT} bytes at line 1`,
		})
	}

	const root = new Map<string, PositionedValue>()
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
		frontMatter = frontMatter.replace(/ +(?=\n|$)/gm, '')
	}

	// Lazy — the regex scan below only runs the first time any key's line
	// is actually needed (duplicate-key/warning/strict-mode/resource-limit
	// messages), never on the happy path otherwise.
	let keyLineNumbers: number[] | null = null
	const keyLine = (i: number): number => {
		if (keyLineNumbers === null) {
			const keyPositions: number[] = []
			const re = new RegExp(KEY_RE.source, 'gm')
			let m: RegExpExecArray | null
			while ((m = re.exec(frontMatter)) !== null) keyPositions.push(m.index)
			// Single combined O(document length) sweep instead of one
			// lineAt() scan-from-start per key — keyPositions is strictly
			// ascending (regex exec proceeds forward), so every position's
			// line can be read off one shared pass instead of each
			// independently re-scanning from character 0.
			keyLineNumbers = new Array(keyPositions.length)
			let line = 1
			let posIdx = 0
			for (let charIdx = 0; charIdx <= frontMatter.length && posIdx < keyPositions.length; charIdx++) {
				while (posIdx < keyPositions.length && keyPositions[posIdx] === charIdx) {
					keyLineNumbers[posIdx] = line
					posIdx++
				}
				if (frontMatter.charCodeAt(charIdx) === 10) line++
			}
		}
		return keyLineNumbers[i]
	}

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

	const parts    = frontMatter.split(KEY_RE).slice(1)
	const keyCount = parts.length / 5 | 0

	if (keyCount === 0) return root

	if (keyCount > TOP_LEVEL_KEY_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: 1,
			message: `LIMA: too many top-level key entries (max ${TOP_LEVEL_KEY_LIMIT}) at line 1`,
		})
	}

	for (let i = 0; i < keyCount; i++) {
		const rawDQ = parts[i * 5 + 2]
		const key   = parts[i * 5] ?? parts[i * 5 + 1] ?? (rawDQ !== undefined ? unescapeDQ(rawDQ) : undefined)
		if (key === undefined) continue
		checkKeyLength(key, () => keyLine(i))

		if (root.has(key)) {
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

		const sep     = parts[i * 5 + 3]
		const raw     = parts[i * 5 + 4] ?? ''
		const isBlock = sep.charCodeAt(sep.length - 1) === 10

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
			const parsed = parseBlock(lines, 0, baseIndent, ctx, keyLine(i) + 1).value
			root.set(key, parsed ?? { kind: 'null', line: keyLine(i) })
		} else {
			if (lines.length === 0) {
				root.set(key, { kind: 'null', line: keyLine(i) })
				continue
			}

			const line0Trimmed = lines[0].trim()
			if (lines.length === 1 || line0Trimmed !== '|') {
				const line0 = lines[0]
				const val   = line0.includes('#') ? stripComment(line0) : line0
				const flowSeq = parseFlowSequence(val, ctx, keyLine(i))
				if (flowSeq !== null) {
					root.set(key, { kind: 'array', items: flowSeq, line: keyLine(i) })
				} else {
					const flowMap = parseFlowMapping(val, ctx, keyLine(i))
					root.set(key, flowMap !== null ? flowMap : parseScalarValue(val, ctx, keyLine(i)))
				}
				continue
			}

			// Multi-line string (`|` literal block scalar).
			const bodyLines = raw.slice(raw.indexOf('\n') + 1).split('\n')

			let minIndent = Infinity
			for (const bodyLine of bodyLines) {
				if (!bodyLine.trim()) continue
				const indent = bodyLine.length - bodyLine.trimStart().length
				if (indent < minIndent) minIndent = indent
			}
			minIndent = Math.min(minIndent, key.length + 2)
			const trimAmt = minIndent > 1 && isFinite(minIndent) ? minIndent : 0

			const mergedLines: string[] = []
			for (const bodyLine of bodyLines) {
				const dedented = trimAmt > 0 ? bodyLine.slice(trimAmt) : bodyLine
				const isContinuation = dedented.startsWith('^^')
				const content = (isContinuation ? dedented.slice(2) : dedented).trimEnd()
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
			root.set(key, { kind: 'string', value: joined, line: keyLine(i), quoted: false })
		}
	}

	// Core §9 nesting depth, over Core's own reference-inert tree. When
	// References is layered on top, it re-checks depth on the final,
	// post-substitution tree separately — substituted values can add depth
	// this check cannot see yet.
	const rootValues = [...root.values()]
	const depth = rootValues.length === 0 ? 0 : Math.max(...rootValues.map(depthOfPositioned))
	if (depth > NESTING_DEPTH_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: 1,
			message: `LIMA: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1`,
		})
	}

	return root
}

/** The public result shape (Core §11.1): every value `toNative*` can produce. */
export type NativeValue =
	| null | boolean | number | string | Date
	| NativeValue[]
	| { [key: string]: NativeValue }

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
	const root = parseCoreWithPositions(frontMatter, { strict: options?.strict ?? false, onWarning: options?.onWarning })
	const out = emptyMapping()
	for (const [k, v] of root) out[k] = toNativeFromPositioned(v)
	return out as unknown as T
}
