import type { SourcePositions, ValueBuilder } from './builder.js'
import { SourceBlockCursor } from './block-cursor.js'
import { parseBlockRange, parseInlineValue } from './block.js'
import { parseCore } from './core.js'
import { LimaError, type LimaDiagnostic } from './errors.js'
import { flowValueReader } from './flow.js'
import {
	NESTING_DEPTH_LIMIT, checkKeyLength, checkDuplicateKey, type ParseContext,
} from './normalize.js'
import { parse } from './references2.js'
import { scanKeys } from './scanner.js'
import { stripCommentKeepEscapes, stripKeyQuotes } from './scalars.js'
import { isBlockScalarMarker } from './structure.js'

export interface LimaPoint {
	/** One-based source line. */
	readonly line: number
	/** One-based column in UTF-16 code units. */
	readonly column: number
	/** UTF-16 code units from the start of the BOM-free input. */
	readonly offset: number
}

export interface LimaSpan {
	readonly start: LimaPoint
	/** Exclusive end. */
	readonly end: LimaPoint
}

export interface LimaOutlineKey {
	readonly key: string
	readonly path: readonly string[]
	readonly span: LimaSpan
	readonly separator: LimaSpan
}

export interface LimaOutline {
	readonly offsetUnit: 'utf16-code-unit'
	readonly keys: readonly LimaOutlineKey[]
	readonly comments: readonly LimaSpan[]
	readonly diagnostics: readonly LimaDiagnostic[]
}

type KeyPosition = { key: string; start: number; end: number; separator: number; line: number; duplicates: boolean }
type Entry = { position: KeyPosition; value: OutlineValue }
type OutlineValue = { entries?: Entry[]; items?: OutlineValue[] }

/** Core §3 normalization, with a boundary map back to the BOM-free physical input. */
function normalize(input: string): { source: string; offsets: number[] } {
	const units: string[] = []
	const offsets: number[] = []
	let leading = true
	for (let i = 0; i < input.length; i++) {
		const c = input[i]
		if (c === '\r' || c === '\n') {
			while (units.at(-1) === ' ') { units.pop(); offsets.pop() }
			offsets.push(i)
			units.push('\n')
			if (c === '\r' && input[i + 1] === '\n') i++
			leading = true
		} else if (leading && c === '\t') {
			units.push(' ', ' ')
			offsets.push(i, i)
		} else {
			units.push(c)
			offsets.push(i)
			if (c !== ' ') leading = false
		}
	}
	while (units.at(-1) === ' ') { units.pop(); offsets.pop() }
	offsets.push(input.length)
	return { source: units.join(''), offsets }
}

/** Editor positions count UTF-16 units, including CRLF's two units. */
function spanReader(input: string, offsets: number[]): (start: number, end: number) => LimaSpan {
	const lines = [0]
	const lineNumbers = new Uint32Array(input.length + 1)
	let line = 0
	for (let i = 0; i < input.length; i++) {
		lineNumbers[i] = line
		if (input[i] === '\r') {
			if (input[i + 1] === '\n') lineNumbers[++i] = line
			lines.push(i + 1)
			line++
		} else if (input[i] === '\n') {
			lines.push(i + 1)
			line++
		}
	}
	lineNumbers[input.length] = line
	const point = (offset: number): LimaPoint => {
		const line = lineNumbers[offset]
		return { line: line + 1, column: offset - lines[line] + 1, offset }
	}
	return (start, end) => ({ start: point(offsets[start]),
		end: point(end > start ? offsets[end - 1] + 1 : offsets[end]) })
}

/** Pair each reader event with the value built immediately after it. */
function outlineBuilder(comment: SourcePositions['comment']): ValueBuilder<OutlineValue, Entry[]> {
	const pending: KeyPosition[] = []
	const failed = new WeakSet<object>()
	const leaf = (): OutlineValue => ({})
	const entry = (value: OutlineValue): Entry => {
		const position = pending.pop()
		if (!position) throw new Error('Lima: missing outline key position')
		return { position, value }
	}
	return {
		positions: true,
		sourcePositions: {
			key: (key, start, end, separator, line) => pending.push({ key, start, end, separator, line, duplicates: false }),
			comment,
			recover: (read, fallback) => {
				const depth = pending.length
				try {
					const value = read()
					if (pending.length !== depth) throw new Error('Lima: unbalanced outline key positions')
					return value
				} catch (error) {
					pending.length = depth
					if (!(error instanceof LimaError) || error.code === 'RESOURCE_LIMIT') throw error
					if (fallback !== null && typeof fallback === 'object') failed.add(fallback)
					return fallback
				}
			},
		},
		null: leaf, bool: leaf, int: leaf, float: leaf, string: leaf, instant: leaf,
		// A failed mapping value keeps its key; an unreadable whole item is skipped.
		array: (items) => ({ items: items.filter((item) => !failed.has(item)) }), createMapping: () => [],
		createMappingWith: (_, value) => [entry(value)],
		hasMappingKey: () => {
			const position = pending.at(-1)
			if (!position) throw new Error('Lima: missing outline duplicate position')
			position.duplicates = true
			return false // diagnostics are collected in source order below
		},
		setMapping: (entries, _, value) => { entries.push(entry(value)) },
		mappingMaxDepth: () => 0, mapping: (entries) => ({ entries }),
	}
}

/** Consume scanner ranges once; nested grammar stays in the block and flow readers. */
function readOutline(
	source: string, builder: ValueBuilder<OutlineValue, Entry[]>, ctx: ParseContext,
	emit: (position: KeyPosition, path: readonly string[]) => void,
	walk: (value: OutlineValue, path: readonly string[]) => void,
): void {
	const positions = builder.sourcePositions
	if (!positions) throw new Error('Lima: missing outline source positions')
	const readValue = flowValueReader(positions)
	const matches = scanKeys(source)
	const preamble = new SourceBlockCursor(source, 0, matches[0]?.matchStart ?? source.length, positions)
	while (preamble.next()) {}
	const topKeys = new Set<string>()
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i]
		const end = matches[i + 1]?.matchStart ?? source.length
		const key = match.unquoted ?? match.singleQuoted ?? stripKeyQuotes(source.slice(match.matchStart, match.sepStart - 1))
		checkDuplicateKey(topKeys.has(key), key, match.line, ctx)
		topKeys.add(key)
		emit({ key, start: match.matchStart, end: match.sepStart - 1,
			separator: match.sepStart - 1, line: match.line, duplicates: true }, [])
		const cursor = new SourceBlockCursor(source, match.isBlock ? match.rawStart : match.matchStart, end, positions)
		if (match.isBlock) {
			const value = parseBlockRange(source, match.rawStart, end, ctx, match.line + 1, builder, { mayExceed: false }, cursor)
			if (value) walk(value, [key])
		} else {
			cursor.next()
			cursor.excludeCommentsBefore(match.rawStart)
			const raw = source.slice(match.rawStart, cursor.lineEnd)
			const value = stripCommentKeepEscapes(raw).trim()
			const column = match.rawStart - match.matchStart + raw.length - raw.trimStart().length
			walk(parseInlineValue(value, isBlockScalarMarker(source, match.rawStart, cursor.lineEnd), 0, match.line,
				column, raw, cursor, ctx, builder, readValue), [key])
		}
		while (cursor.valid) cursor.next()
	}
}

/** Source structure for editors; references are only evaluated by the diagnostic oracle. */
export function outline(frontMatter: string): LimaOutline {
	const diagnostics: LimaDiagnostic[] = []
	const keys: LimaOutlineKey[] = []
	const comments: LimaSpan[] = []
	const result: LimaOutline = { offsetUnit: 'utf16-code-unit', keys, comments, diagnostics }
	const diagnosticKeys = new Set<string>()
	const addWarning = (warning: LimaDiagnostic): void => {
		const identity = JSON.stringify([warning.code, warning.line, warning.key])
		if (diagnosticKeys.has(identity)) return
		diagnosticKeys.add(identity)
		diagnostics.push(warning)
	}
	let limited = false
	try { parse(frontMatter, { strict: true }) } catch (error) {
		if (!(error instanceof LimaError)) throw error
		addWarning({ ...error, message: error.message })
		limited = error.code === 'RESOURCE_LIMIT'
	}
	// Also check limits beyond strict mode's first error, and collect duplicate
	// warnings without resolving references in the tolerant structural pass.
	try {
		parseCore(frontMatter, { onWarning: (warning) => addWarning(warning as LimaDiagnostic) })
	} catch (error) {
		if (!(error instanceof LimaError)) throw error
		if (error.code === 'RESOURCE_LIMIT') {
			limited = true
			if (!diagnostics.some((d) => d.code === error.code && d.line === error.line))
				addWarning({ ...error, message: error.message })
		}
	}
	if (limited) return result

	try {
		const input = frontMatter.startsWith('\uFEFF') ? frontMatter.slice(1) : frontMatter
		const { source, offsets } = normalize(input)
		const span = spanReader(input, offsets)
		const ctx: ParseContext = { strict: false, onWarning: (warning) => addWarning(warning as LimaDiagnostic) }
		const builder = outlineBuilder((start, end) => {
			const comment = span(start, end)
			let physicalEnd = comment.end.offset
			while (physicalEnd < input.length && input[physicalEnd] !== '\r' && input[physicalEnd] !== '\n') physicalEnd++
			comments.push({ start: comment.start, end: { ...comment.end,
				column: comment.end.column + physicalEnd - comment.end.offset, offset: physicalEnd } })
		})
		const emit = (position: KeyPosition, path: readonly string[]): void => {
			checkKeyLength(position.key, position.line)
			const colon = span(position.separator, position.separator + 1)
			const separator = input[colon.end.offset] === ' '
				? { start: colon.start, end: { ...colon.end, column: colon.end.column + 1, offset: colon.end.offset + 1 } }
				: colon
			keys.push({ key: position.key, path: [...path, position.key], span: span(position.start, position.end), separator })
		}
		const walk = (value: OutlineValue, path: readonly string[], depth = 0): void => {
			if (value.entries || value.items) depth++
			if (depth > NESTING_DEPTH_LIMIT) throw new LimaError({ code: 'RESOURCE_LIMIT', line: 1,
				message: `Lima: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1` })
			const seen = new Set<string>()
			for (const { position, value: child } of value.entries ?? []) {
				if (position.start === position.end) continue
				if (position.duplicates) checkDuplicateKey(seen.has(position.key), position.key, position.line, ctx)
				seen.add(position.key)
				emit(position, path)
				walk(child, [...path, position.key], depth)
			}
			value.items?.forEach((item, index) => walk(item, [...path, String(index)], depth))
		}
		readOutline(source, builder, ctx, emit, walk)
	} catch (error) {
		if (!(error instanceof LimaError)) throw error
		keys.length = 0
		comments.length = 0
		if (!diagnostics.some((d) => d.code === error.code && d.line === error.line))
			addWarning({ ...error, message: error.message })
	}
	return result
}
