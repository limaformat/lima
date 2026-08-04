/**
 * Core §7 block collections (sequences and mappings) — a direct structural
 * port of the legacy block parser, generic over its output representation
 * (see `builder.ts`) so `parseCore` can build the public native result
 * directly, without also building the References-only annotated
 * `PositionedValue` tree it never needs. No reference-resolution concerns
 * at all (no `resolve()` call anywhere, no array-as-sequence-item
 * reference-shape check — that error class cannot occur here since Core
 * never resolves a reference in the first place).
 */

import { LString } from './value.js'
import { type ParseContext, checkKeyLength, checkDuplicateKey, checkScalarLimit } from './normalize.js'
import {
	stripKeyQuotes, unescapeDQ, stripComment,
	parseQuotedOrTyped,
} from './scalars.js'
import { parseFlowMapping, parseFlowOrScalarValue } from './flow.js'
import { LimaError } from './errors.js'
import type { ValueBuilder } from './builder.js'
import { isTrimWhitespace } from './chars.js'

const DASH_PREFIX_RE = /^-\s+/

export const findKeySep = (s: string): number => {
	const first = s.charCodeAt(0)
	if (first === 39 || first === 34) {
		let i = 1
		while (i < s.length && s.charCodeAt(i) !== first) i++
		if (s.charCodeAt(i + 1) === 58 && s.charCodeAt(i + 2) === 32) return i + 1
		return -1
	}
	return s.indexOf(': ')
}

/**
 * Recursively parses a block value over numeric line spans in the original
 * source. Strings are materialized only when grammar or scalar parsing needs
 * their content.
 */
type BlockLines = {
	source: string
	starts: number[]
	indents: number[]
	end: number
	finalNewline: boolean
}

const blockLineEnd = (lines: BlockLines, index: number): number => index + 1 < lines.starts.length
	? lines.starts[index + 1] - 1
	: (lines.finalNewline ? lines.end - 1 : lines.end)

const blockLineLength = (lines: BlockLines, index: number): number =>
	blockLineEnd(lines, index) - lines.starts[index]

const blockContent = (lines: BlockLines, index: number, indent: number): string =>
	lines.source.slice(lines.starts[index] + indent, blockLineEnd(lines, index))

/** The dash-prefix regex semantics, directly over a source span, with one final slice. */
const blockAfterDash = (lines: BlockLines, index: number, indent: number): string => {
	const start = lines.starts[index] + indent
	const end = blockLineEnd(lines, index)
	if (start + 1 === end) return ''
	let content = start + 1
	if (!isTrimWhitespace(lines.source.charCodeAt(content))) return lines.source.slice(start, end)
	while (content < end && isTrimWhitespace(lines.source.charCodeAt(content))) content++
	return lines.source.slice(content, end)
}

/** `source.slice(start, end).trim()` with no temporary untrimmed substring. */
const trimSlice = (source: string, start: number, end: number): string => {
	if (start < end) {
		const first = source.charCodeAt(start)
		const last = source.charCodeAt(end - 1)
		// Printable ASCII cannot be consumed by trim(), except U+0020 SPACE.
		// Canonical frontmatter keys/values overwhelmingly have printable,
		// non-space ASCII boundaries, so avoid both Unicode predicate calls.
		if (first > 0x20 && first < 0x7f && last > 0x20 && last < 0x7f) {
			return source.slice(start, end)
		}
	}
	while (start < end && isTrimWhitespace(source.charCodeAt(start))) start++
	while (end > start && isTrimWhitespace(source.charCodeAt(end - 1))) end--
	return source.slice(start, end)
}

const parseBlock = <V, M>(
	lines: BlockLines,
	startIdx: number,
	baseIndent: number,
	ctx: ParseContext,
	baseLine: number,
	builder: ValueBuilder<V, M>,
): { value: V | null; nextIdx: number } => {
	let items: V[] | null = null
	let entries: M | null = null
	let pendingItem: M | null = null
	let idx = startIdx

	while (idx < lines.starts.length) {
		const indent = lines.indents[idx]
		if (indent === blockLineLength(lines, idx)) { idx++; continue }
		const firstCode = lines.source.charCodeAt(lines.starts[idx] + indent)
		if (firstCode === 35) { idx++; continue }

		if (indent < baseIndent) break

		if (indent > baseIndent) {
			const trimmed = blockContent(lines, idx, indent)
			if (items !== null && pendingItem !== null) {
				const colonPos = findKeySep(trimmed)
				if (colonPos !== -1) {
					const itemKey = stripKeyQuotes(trimSlice(trimmed, 0, colonPos))
					checkKeyLength(itemKey, () => baseLine + idx)
					let itemVal = trimSlice(trimmed, colonPos + 2, trimmed.length)
					if (itemVal.includes('#')) itemVal = stripComment(itemVal)
					builder.setMapping(pendingItem, itemKey, parseFlowOrScalarValue(itemVal, ctx, baseLine + idx, builder))
					idx++
				} else if (trimmed.endsWith(':')) {
					const itemKey = stripKeyQuotes(trimSlice(trimmed, 0, trimmed.length - 1))
					const keyLineNum = baseLine + idx
					checkKeyLength(itemKey, () => keyLineNum)
					idx++
					let ni = idx
					while (ni < lines.starts.length && lines.indents[ni] === blockLineLength(lines, ni)) ni++
					if (ni < lines.starts.length) {
						const nextIndent = lines.indents[ni]
						if (nextIndent > indent) {
							const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder)
							builder.setMapping(pendingItem, itemKey, nested ?? builder.null(keyLineNum))
							idx = after
							continue
						}
					}
					builder.setMapping(pendingItem, itemKey, builder.null(keyLineNum))
				} else {
					if (ctx.strict) throw new LimaError({
						code: 'INVALID_INDENTATION', line: baseLine + idx,
						message: `LIMA: unexpected syntax in array item continuation at line ${baseLine + idx}: "${trimmed}"`,
					})
					idx++
				}
			} else {
				if (ctx.strict) throw new LimaError({
					code: 'INVALID_INDENTATION', line: baseLine + idx,
					message: `LIMA: unexpected indentation at line ${baseLine + idx}: "${trimmed}"`,
				})
				idx++
			}
			continue
		}

		// ── indent === baseIndent ──────────────────────────────────────────
		const isList = firstCode === 45

		if (isList) {
			if (pendingItem !== null) {
				items!.push(builder.mapping(pendingItem, baseLine + idx))
				pendingItem = null
			}

			if (items === null) items = []
			if (entries !== null) {
				if (ctx.strict) throw new LimaError({
					code: 'INVALID_INDENTATION', line: baseLine + idx,
					message: `LIMA: mixed array and map entries for the same key at line ${baseLine + idx}`,
				})
				idx++; continue
			}

			// Claude Code review fix: the fast path only ever inspected the
			// single character right after the dash, so it stripped exactly
			// one whitespace character even when DASH_PREFIX_RE's `\s+` would
			// have consumed a longer run (e.g. two spaces, or a space then a
			// tab) — confirmed via differential testing: `-  value` (two
			// spaces) produced `" value"` (leading space preserved) instead
			// of `"value"`, and for a flow-shaped item the stray leading
			// space broke the `[`/`{`/quote first-character check entirely —
			// `-  {a: 1}` produced a mangled `{"{a":"1}"}` instead of the
			// parsed mapping `{a:1}`. Reverted to the regex, which correctly
			// consumes the whole whitespace run regardless of length or kind.
			let afterDash = blockAfterDash(lines, idx, indent)
			if (afterDash.includes('#')) afterDash = stripComment(afterDash)
			// Claude Code review fix (round 3): this gate skips the flow-mapping
			// probe and findKeySep to fast-path an ordinary scalar list item,
			// but originally didn't exclude a bare "key:" marker (a dash item
			// that's itself a mapping key with its value nested on following
			// lines, e.g. `- author:\n    name: Alice`) — findKeySep's
			// ': '-substring check and this fast path's identical `indexOf(': ')`
			// check both correctly return "no colon found" for "author:" (no
			// space follows the trailing colon), so the fast path took over
			// and treated "author:" as a literal scalar string, silently
			// discarding the nested mapping entirely (confirmed via
			// differential testing: candidate produced {"items":["author:"]}
			// instead of baseline's {"items":[{"author":{"name":"Alice"}}]}).
			// The slow path's next branch after this one specifically checks
			// `afterDash.endsWith(':')` for exactly this case; the fast path
			// must exclude it too.
			const simpleFirst = afterDash.charCodeAt(0)
			if (simpleFirst !== 34 && simpleFirst !== 39 && simpleFirst !== 45 && simpleFirst !== 123 &&
				afterDash.indexOf(': ') === -1 && !afterDash.endsWith(':')) {
				items.push(parseQuotedOrTyped(afterDash, ctx, baseLine + idx, false, builder))
				idx++
				continue
			}
			const flowMap   = parseFlowMapping(afterDash, ctx, baseLine + idx, builder)
			const colonPos  = findKeySep(afterDash)

			if (flowMap !== null) {
				items.push(flowMap)
				idx++
			} else if (afterDash === '-' || DASH_PREFIX_RE.test(afterDash)) {
				if (ctx.strict) throw new LimaError({
					code: 'INVALID_INDENTATION', line: baseLine + idx,
					message: `LIMA: nested block sequence at line ${baseLine + idx}: "${blockContent(lines, idx, indent)}"`,
				})
				items.push(builder.null(baseLine + idx))
				idx++
				while (idx < lines.starts.length) {
					const nextIndent = lines.indents[idx]
					if (nextIndent === blockLineLength(lines, idx) || blockContent(lines, idx, nextIndent).charCodeAt(0) === 35) { idx++; continue }
					if (nextIndent <= baseIndent) break
					idx++
				}
			} else if (colonPos !== -1) {
				const pendingKey = stripKeyQuotes(trimSlice(afterDash, 0, colonPos))
				checkKeyLength(pendingKey, () => baseLine + idx)
				const pendingRaw = trimSlice(afterDash, colonPos + 2, afterDash.length)
				pendingItem = builder.createMappingWith(
					pendingKey, parseFlowOrScalarValue(pendingRaw, ctx, baseLine + idx, builder),
				)
				idx++
				// Canonical multi-key object items dominate frontmatter object
				// lists. Consume only unquoted `key: value` continuation lines
				// directly from the original line; every other syntax shape is
				// left untouched for the existing branch chain on the next loop.
				while (idx < lines.starts.length) {
					const continuationIndent = lines.indents[idx]
					if (continuationIndent <= baseIndent) break
					const continuationStart = lines.starts[idx] + continuationIndent
					const continuationEnd = blockLineEnd(lines, idx)
					const first = lines.source.charCodeAt(continuationStart)
					if (first === 34 || first === 39 || first === 35) break
					const continuationColon = lines.source.indexOf(': ', continuationStart)
					if (continuationColon === -1 || continuationColon >= continuationEnd) break
					const continuationKey = trimSlice(lines.source, continuationStart, continuationColon)
					if (!continuationKey) break
					checkKeyLength(continuationKey, () => baseLine + idx)
					let continuationValue = trimSlice(lines.source, continuationColon + 2, continuationEnd)
					if (continuationValue.includes('#')) continuationValue = stripComment(continuationValue)
					builder.setMapping(pendingItem, continuationKey,
						parseFlowOrScalarValue(continuationValue, ctx, baseLine + idx, builder))
					idx++
				}
			} else if (afterDash.endsWith(':')) {
				const itemKey = stripKeyQuotes(trimSlice(afterDash, 0, afterDash.length - 1))
				const keyLineNum = baseLine + idx
				checkKeyLength(itemKey, () => keyLineNum)
				idx++
				let ni = idx
				while (ni < lines.starts.length && lines.indents[ni] === blockLineLength(lines, ni)) ni++
				if (ni < lines.starts.length) {
					const nextIndent = lines.indents[ni]
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder)
						pendingItem = builder.createMappingWith(itemKey, nested ?? builder.null(keyLineNum))
						idx = after
						continue
					}
				}
				pendingItem = builder.createMappingWith(itemKey, builder.null(keyLineNum))
			} else {
				const qFirst = afterDash.charCodeAt(0)
				if ((qFirst === 34 || qFirst === 39) && afterDash.charCodeAt(afterDash.length - 1) === qFirst) {
					const inner = afterDash.slice(1, -1)
					const value = qFirst === 34 ? unescapeDQ(inner, ctx.strict, baseLine + idx) : inner.replace(/\\'/g, "'")
					checkScalarLimit(LString(value), baseLine + idx)
					items.push(builder.string(value, baseLine + idx, true))
				} else {
					items.push(parseQuotedOrTyped(afterDash, ctx, baseLine + idx, false, builder))
				}
				idx++
			}
		} else {
			const trimmed = blockContent(lines, idx, indent)
			// ── Map entry ────────────────────────────────────────────────────
			if (items !== null) {
				if (ctx.strict) throw new LimaError({
					code: 'INVALID_INDENTATION', line: baseLine + idx,
					message: `LIMA: mixed map and array entries for the same key at line ${baseLine + idx}`,
				})
				idx++; continue
			}

			const colonPos = findKeySep(trimmed)
			if (colonPos !== -1) {
				if (entries === null) entries = builder.createMapping()
				const itemKey = stripKeyQuotes(trimSlice(trimmed, 0, colonPos))
				checkKeyLength(itemKey, () => baseLine + idx)
				if (ctx.strict || ctx.onWarning !== undefined) {
					checkDuplicateKey(builder.hasMappingKey(entries, itemKey), itemKey, baseLine + idx, ctx)
				}
				let itemVal = trimSlice(trimmed, colonPos + 2, trimmed.length)
				if (itemVal.includes('#')) itemVal = stripComment(itemVal)
				builder.setMapping(entries, itemKey, parseFlowOrScalarValue(itemVal, ctx, baseLine + idx, builder))
				idx++
			} else if (trimmed.endsWith(':')) {
				if (entries === null) entries = builder.createMapping()
				const itemKey = stripKeyQuotes(trimSlice(trimmed, 0, trimmed.length - 1))
				const keyLineNum = baseLine + idx
				checkKeyLength(itemKey, () => keyLineNum)
				if (ctx.strict || ctx.onWarning !== undefined) {
					checkDuplicateKey(builder.hasMappingKey(entries, itemKey), itemKey, keyLineNum, ctx)
				}
				idx++
				let ni = idx
				while (ni < lines.starts.length && lines.indents[ni] === blockLineLength(lines, ni)) ni++
				if (ni < lines.starts.length) {
					const nextIndent = lines.indents[ni]
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder)
						builder.setMapping(entries, itemKey, nested ?? builder.null(keyLineNum))
						idx = after
						continue
					}
				}
				builder.setMapping(entries, itemKey, builder.null(keyLineNum))
			} else {
				if (ctx.strict) throw new LimaError({
					code: 'INVALID_INDENTATION', line: baseLine + idx,
					message: `LIMA: indented freetext without a block scalar marker at line ${baseLine + idx}: "${trimmed}"`,
				})
				idx++
			}
		}
	}

	if (pendingItem !== null) items!.push(builder.mapping(pendingItem, baseLine + startIdx))

	const value: V | null =
		items !== null ? builder.array(items, baseLine + startIdx) :
		entries !== null ? builder.mapping(entries, baseLine + startIdx) :
		null

	return { value, nextIdx: idx }
}

/** Complete block grammar over numeric line starts in the original source. */
export const parseBlockRange = <V, M>(
	source: string, start: number, end: number, ctx: ParseContext, baseLine: number,
	builder: ValueBuilder<V, M>,
): V | null => {
	const starts: number[] = []
	const indents: number[] = []
	let pos = start
	while (pos < end) {
		starts.push(pos)
		const newline = source.indexOf('\n', pos)
		const limit = newline === -1 || newline >= end ? end : newline
		let content = pos
		while (content < limit && source.charCodeAt(content) === 0x0020) content++
		while (content < limit && isTrimWhitespace(source.charCodeAt(content))) content++
		indents.push(content - pos)
		if (newline === -1 || newline >= end) break
		pos = newline + 1
	}
	const lines: BlockLines = {
		source, starts, indents, end,
		finalNewline: end > start && source.charCodeAt(end - 1) === 10,
	}
	let first = 0
	while (first < starts.length && indents[first] === blockLineLength(lines, first)) first++
	let baseIndent = 0
	if (first < starts.length) {
		const firstStart = starts[first]
		const firstEnd = blockLineEnd(lines, first)
		while (firstStart + baseIndent < firstEnd && source.charCodeAt(firstStart + baseIndent) === 32) baseIndent++
	}
	return parseBlock(lines, 0, baseIndent, ctx, baseLine, builder).value
}
