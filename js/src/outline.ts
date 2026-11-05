import type { ValueBuilder } from './builder.js'
import { BlockCursor } from './block-cursor.js'
import { findKeySep, parseCursorBlock } from './block.js'
import { buildBlockScalar } from './block-scalar.js'
import { parseCore } from './core.js'
import { LimaError, type LimaDiagnostic } from './errors.js'
import { FlowCursor, flowItemSeparator, parseFlowOrScalarValue } from './flow.js'
import {
	byteLength, DOCUMENT_SIZE_LIMIT, TOP_LEVEL_KEY_LIMIT, NESTING_DEPTH_LIMIT, checkKeyLength, checkDuplicateKey, type ParseContext,
} from './normalize.js'
import { parse } from './references2.js'
import { scanKeys } from './scanner.js'
import { isValidKey, stripComment, stripCommentKeepEscapes, stripKeyQuotes } from './scalars.js'

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

type KeySite = { key: string; start: number; end: number; colon: number; line: number; sequence: boolean }
type Entry = { key: string; line: number; exact: boolean; sequence: boolean; value?: OutlineValue }
type OutlineValue = { line: number; entries?: Entry[]; items?: OutlineValue[] }

/** Core §3 normalization, with a boundary map back to the BOM-free physical input. */
function normalize(input: string): { source: string; offsets: number[] } {
	let source = ''
	const offsets: number[] = []
	let leading = true
	for (let i = 0; i < input.length; i++) {
		const c = input[i]
		if (c === '\r' || c === '\n') {
			while (source.endsWith(' ')) { source = source.slice(0, -1); offsets.pop() }
			offsets.push(i)
			source += '\n'
			if (c === '\r' && input[i + 1] === '\n') i++
			leading = true
		} else if (leading && c === '\t') {
			source += '  '
			offsets.push(i, i)
		} else {
			source += c
			offsets.push(i)
			if (c !== ' ') leading = false
		}
	}
	while (source.endsWith(' ')) { source = source.slice(0, -1); offsets.pop() }
	offsets.push(input.length)
	return { source, offsets }
}

/** Editor positions count UTF-16 units, including CRLF's two units. */
function spanReader(input: string, offsets: number[]): (start: number, end: number) => LimaSpan {
	const lines = [0]
	for (let i = 0; i < input.length; i++) {
		if (input[i] === '\r') {
			if (input[i + 1] === '\n') i++
			lines.push(i + 1)
		} else if (input[i] === '\n') lines.push(i + 1)
	}
	const point = (position: number): LimaPoint => {
		const offset = position
		let low = 0, high = lines.length
		while (low + 1 < high) {
			const middle = (low + high) >>> 1
			if (lines[middle] <= offset) low = middle
			else high = middle
		}
		return { line: low + 1, column: offset - lines[low] + 1, offset }
	}
	return (start, end) => ({ start: point(offsets[start]),
		end: point(end > start ? offsets[end - 1] + 1 : offsets[end]) })
}

/** Physical flow sites use the parser's item and separator readers. */
function flowSites(source: string, start: number, end: number, line: number, sites: KeySite[]): void {
	const value = source.slice(start, end).trimEnd()
	const first = value[0], last = value.at(-1)
	if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return
	const cursor = new FlowCursor(value, 1, value.length - 1)
	while (cursor.next()) {
		const a = cursor.itemStart, b = cursor.itemEnd
		if (first === '[') {
			if (value[a] === '{') flowSites(source, start + a, start + b, line, sites)
			continue
		}
		const colon = flowItemSeparator(value, a, b)
		if (colon === -1) continue
		const raw = value.slice(a, colon).trimEnd()
		if (isValidKey(raw)) sites.push({ key: stripKeyQuotes(raw), start: start + a,
			end: start + a + raw.length, colon: start + colon, line, sequence: false })
	}
}

/**
 * The real block/flow parsers build an occurrence tree. With warnings enabled,
 * hasMappingKey records a key's line before its value is read. Sequence-item
 * entries without duplicate checks are anchored by their value's first line.
 * Physical sites are assigned in source order when walking the finished tree,
 * so a flow key named like its enclosing key cannot steal the parent's site.
 */
function outlineBuilder(currentLine: () => number): ValueBuilder<OutlineValue, Entry[]> {
	const leaf = (line: number): OutlineValue => ({ line })
	return {
		null: leaf, bool: (_, line) => leaf(line), int: (_, line) => leaf(line),
		float: (_, line) => leaf(line), string: (_, line) => leaf(line), instant: (_, line) => leaf(line),
		array: (items, line) => ({ line, items }), createMapping: () => [],
		createMappingWith: (key, value) => [{ key, line: value.line, exact: false, sequence: true, value }],
		hasMappingKey: (entries, key) => {
			entries.push({ key, line: currentLine(), exact: true, sequence: false })
			return false // diagnostics come from separate public-parser passes
		},
		setMapping: (entries, key, value) => {
			const entry = entries.findLast((e) => e.key === key && e.value === undefined)
			if (entry) entry.value = value
			else entries.push({ key, line: value.line, exact: false, sequence: false, value })
		},
		mappingMaxDepth: () => 0, mapping: (entries, line) => ({ line, entries }),
	}
}

/** Source structure for editors; references are only evaluated by the diagnostic oracle. */
export function outline(frontMatter: string): LimaOutline {
	const diagnostics: LimaDiagnostic[] = []
	const keys: LimaOutlineKey[] = []
	const comments: LimaSpan[] = []
	const result: LimaOutline = { offsetUnit: 'utf16-code-unit', keys, comments, diagnostics }
	const addWarning = (warning: LimaDiagnostic): void => {
		if (!diagnostics.some((d) => d.code === warning.code && d.line === warning.line && d.key === warning.key))
			diagnostics.push(warning)
	}
	let limited = false
	try { parse(frontMatter, { strict: true }) } catch (error) {
		if (!(error instanceof LimaError)) throw error
		diagnostics.push({ ...error, message: error.message })
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
				diagnostics.push({ ...error, message: error.message })
		}
	}
	if (limited) return result

	try {
		if (byteLength(frontMatter) > DOCUMENT_SIZE_LIMIT) throw new LimaError({ code: 'RESOURCE_LIMIT', line: 1,
			message: `Lima: document exceeds maximum size of ${DOCUMENT_SIZE_LIMIT} bytes at line 1` })
		const input = frontMatter.startsWith('\uFEFF') ? frontMatter.slice(1) : frontMatter
		const { source, offsets } = normalize(input)
		const span = spanReader(input, offsets)
		const matches = scanKeys(source)
		if (matches.length > TOP_LEVEL_KEY_LIMIT) throw new LimaError({ code: 'RESOURCE_LIMIT', line: 1,
			message: `Lima: too many top-level key entries (max ${TOP_LEVEL_KEY_LIMIT}) at line 1` })
		const scalarLines = new Set<number>()
		const ctx: ParseContext = { strict: false, onWarning: (warning) => addWarning(warning as LimaDiagnostic) }
		const topKeys = new Set<string>()
		const emit = (site: KeySite, path: readonly string[]): void => {
			checkKeyLength(site.key, site.line)
			const colon = span(site.colon, site.colon + 1)
			const separator = input[colon.end.offset] === ' '
				? { start: colon.start, end: { ...colon.end, column: colon.end.column + 1, offset: colon.end.offset + 1 } }
				: colon
			keys.push({ key: site.key, path: [...path, site.key], span: span(site.start, site.end), separator })
			const lineEnd = source.indexOf('\n', site.colon)
			const end = lineEnd === -1 ? source.length : lineEnd
			if (source.slice(site.colon + 1, end).trim() === '|') {
				const body = source.slice(end + 1).split('\n')
				if (body.at(-1) === '') body.pop()
				const column = site.start - (source.lastIndexOf('\n', site.start - 1) + 1)
				const consumed = buildBlockScalar(body, column, site.line, ctx, outlineBuilder(() => site.line)).consumed
				for (let j = 1; j <= consumed; j++) scalarLines.add(site.line + j)
			}
		}
		const walk = (value: OutlineValue, path: readonly string[], sites: KeySite[], position: { after: number }, depth = 0): void => {
			if (value.entries || value.items) depth++
			if (depth > NESTING_DEPTH_LIMIT) throw new LimaError({ code: 'RESOURCE_LIMIT', line: 1,
				message: `Lima: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1` })
			let keyColumn: number | undefined
			const seen = new Set<string>()
			for (const entry of value.entries ?? []) {
				const site = sites.find((s) => s.key === entry.key && s.start > position.after &&
					!scalarLines.has(s.line) && s.sequence === entry.sequence &&
					(entry.exact ? s.line === entry.line : s.line <= entry.line) &&
					(entry.exact || entry.sequence || keyColumn === undefined ||
						s.start - (source.lastIndexOf('\n', s.start - 1) + 1) === keyColumn))
				if (!site) throw new Error(`Lima outline: missing source site for ${JSON.stringify(entry.key)} at line ${entry.line}`)
				keyColumn ??= site.start - (source.lastIndexOf('\n', site.start - 1) + 1)
				if (entry.exact) checkDuplicateKey(seen.has(entry.key), entry.key, site.line, ctx)
				seen.add(entry.key)
				emit(site, path)
				position.after = site.start
				if (entry.value) walk(entry.value, [...path, entry.key], sites, position, depth)
			}
			value.items?.forEach((item, index) => walk(item, [...path, String(index)], sites, position, depth))
		}
		for (let i = 0; i < matches.length; i++) {
			const match = matches[i]
			const end = matches[i + 1]?.matchStart ?? source.length
			const key = match.unquoted ?? match.singleQuoted ?? stripKeyQuotes(source.slice(match.matchStart, match.sepStart - 1))
			const site: KeySite = { key, start: match.matchStart, end: match.sepStart - 1,
				colon: match.sepStart - 1, line: match.line, sequence: false }
			checkDuplicateKey(topKeys.has(key), key, site.line, ctx)
			topKeys.add(key)
			emit(site, [])
			const sites: KeySite[] = []
			const cursor = new BlockCursor(source, match.isBlock ? match.rawStart : match.matchStart, end)
			while (cursor.next()) {
				const line = (match.isBlock ? match.line + 1 : match.line) + cursor.lineIndex
				if (scalarLines.has(line) || cursor.empty || cursor.firstCode === 35) continue
				let start = cursor.contentStart
				let sequence = false
				if (source[start] === '-' && (start + 1 === cursor.lineEnd || source[start + 1].trim() === '')) {
					sequence = true
					start++
					while (start < cursor.lineEnd && source[start].trim() === '') start++
				}
				const content = source.slice(start, cursor.lineEnd).trimEnd()
				let colon = findKeySep(content)
				if (colon === -1 && content.endsWith(':')) colon = content.length - 1
				const rawKey = colon === -1 ? '' : content.slice(0, colon).trimEnd()
				let valueStart = start
				if (colon !== -1 && isValidKey(rawKey)) {
					const candidate: KeySite = { key: stripKeyQuotes(rawKey), start, end: start + rawKey.length,
						colon: start + colon, line, sequence }
					if (start !== match.matchStart) sites.push(candidate)
					valueStart = start + colon + 1
					while (valueStart < cursor.lineEnd && source[valueStart].trim() === '') valueStart++
				}
				const raw = stripCommentKeepEscapes(source.slice(valueStart, cursor.lineEnd))
				flowSites(source, valueStart, valueStart + raw.length, line, sites)
			}
			if (match.isBlock) {
				// Some malformed flows throw even in non-strict mode. Replace
				// their value with a scalar (or skip an unreadable item) and retry.
				let tolerant = source
				for (;;) {
					const block = new BlockCursor(tolerant, match.rawStart, end)
					while (block.next() && (block.empty || block.firstCode === 35)) {}
					if (!block.valid || (block.asciiIndent === 0 && block.firstCode !== 45)) break
					const builder = outlineBuilder(() => match.line + 1 + block.lineIndex)
					try {
						const value = parseCursorBlock(block, block.asciiIndent, ctx, match.line + 1, builder, block.asciiIndent === 0)
						if (value) walk(value, [key], sites, { after: site.start })
						break
					} catch (error) {
						if (!(error instanceof LimaError)) throw error
						if (error.code === 'RESOURCE_LIMIT') throw error
						const line = match.line + 1 + block.lineIndex
						const keySite = sites.find((s) => s.line === line && (s.start === block.contentStart || s.sequence))
						const a = keySite ? keySite.colon + 1 : block.lineStart, b = block.lineEnd
						const replacement = keySite ? ' 0'.padEnd(b - a, ' ') : ' '.repeat(b - a)
						tolerant = tolerant.slice(0, a) + replacement + tolerant.slice(b)
					}
				}
			} else {
				const raw = stripComment(source.slice(match.rawStart, match.inlineEnd ?? end)).trim()
				if (raw !== '|') {
					try { walk(parseFlowOrScalarValue(raw, ctx, match.line, outlineBuilder(() => match.line)), [key], sites, { after: site.start }) }
					catch (error) { if (!(error instanceof LimaError) || error.code === 'RESOURCE_LIMIT') throw error }
				}
			}
		}
		const lines = new BlockCursor(source, 0, source.length)
		while (lines.next()) {
			if (scalarLines.has(lines.lineIndex + 1)) continue
			let start = lines.contentStart
			// Quoted-key contents do not participate in value comment stripping.
			const key = keys.find((k) => k.span.start.line === lines.lineIndex + 1)
			if (key) while (start < lines.lineEnd && offsets[start] < key.separator.end.offset) start++
			const raw = source.slice(start, lines.lineEnd)
			const kept = stripCommentKeepEscapes(raw)
			if (kept.length !== raw.length) {
				const hash = source.indexOf('#', start + kept.length)
				const comment = span(hash, lines.lineEnd)
				let end = comment.end.offset
				while (end < input.length && input[end] !== '\r' && input[end] !== '\n') end++
				comments.push({ start: comment.start, end: { ...comment.end,
					column: comment.end.column + end - comment.end.offset, offset: end } })
			}
		}
		keys.sort((a, b) => a.span.start.offset - b.span.start.offset)
	} catch (error) {
		if (!(error instanceof LimaError)) throw error
		keys.length = 0
		comments.length = 0
		if (!diagnostics.some((d) => d.code === error.code && d.line === error.line))
			diagnostics.push({ ...error, message: error.message })
	}
	return result
}
