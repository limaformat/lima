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

const DASH_PREFIX_RE = /^-\s+/

/**
 * The exact ECMAScript WhiteSpace + LineTerminator code-point set consumed
 * by String.prototype.trimStart(). Keeping the set explicit avoids the
 * substring allocation in the block parser's hottest operation without
 * narrowing behavior to ASCII space (notably, U+00A0 indentation must keep
 * working). All members are single UTF-16 code units, so the returned index
 * is identical to `line.length - line.trimStart().length`.
 *
 * Claude Code review fix (round 2): the range below used to start at
 * 0x000b, omitting U+000A (LINE FEED) from the set — confirmed by
 * exhaustively comparing every BMP code point's actual `trimStart()`
 * behavior against this predicate. Currently unreachable in practice (every
 * `line` this function sees comes from splitting on `\n` upstream, so no
 * individual line can ever contain one), but the doc comment above claims
 * "the exact" set, which was false, and this function has no other
 * enforced guarantee tying it to that invariant — a future caller outside
 * `parseBlock`'s current pre-split usage could reintroduce the gap as a
 * real bug. One code point, no behavioral or performance change today.
 */
const isTrimWhitespace = (c: number): boolean =>
	c === 0x0009 || (c >= 0x000a && c <= 0x000d) || c === 0x0020 || c === 0x00a0 ||
	c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
	c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff

const lineIndent = (line: string): number => {
	let i = 0
	// Plain spaces dominate normalized frontmatter indentation. Keep that
	// path to one cheap comparison per character, then fall back to the full
	// trimStart set for mixed or non-ASCII whitespace.
	while (i < line.length && line.charCodeAt(i) === 0x0020) i++
	while (i < line.length && isTrimWhitespace(line.charCodeAt(i))) i++
	return i
}

const isBlankLine = (line: string): boolean => lineIndent(line) === line.length

/** Equivalent to `line.replace(/^-\s+/, '')` for a dash-prefixed line. */
const stripDashPrefix = (line: string): string => {
	let i = 1
	if (!isTrimWhitespace(line.charCodeAt(i))) return line
	while (i < line.length && isTrimWhitespace(line.charCodeAt(i))) i++
	return line.slice(i)
}

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
 * Recursively parses a block value (array or mapping) from an array of
 * lines.
 */
export const parseBlock = <V, M>(
	lines: string[],
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

	while (idx < lines.length) {
		const line    = lines[idx]
		const indent = lineIndent(line)
		if (indent === line.length) { idx++; continue }
		const trimmed = indent === 0 ? line : line.slice(indent)
		if (trimmed.charCodeAt(0) === 35) { idx++; continue }

		if (indent < baseIndent) break

		if (indent > baseIndent) {
			if (items !== null && pendingItem !== null) {
				const colonPos = findKeySep(trimmed)
				if (colonPos !== -1) {
					const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
					checkKeyLength(itemKey, () => baseLine + idx)
					let itemVal = trimmed.slice(colonPos + 2).trim()
					if (itemVal.includes('#')) itemVal = stripComment(itemVal)
					builder.setMapping(pendingItem, itemKey, parseFlowOrScalarValue(itemVal, ctx, baseLine + idx, builder))
					idx++
				} else if (trimmed.endsWith(':')) {
					const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
					const keyLineNum = baseLine + idx
					checkKeyLength(itemKey, () => keyLineNum)
					idx++
					let ni = idx
					while (ni < lines.length && isBlankLine(lines[ni])) ni++
					if (ni < lines.length) {
						const nextIndent = lineIndent(lines[ni])
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
		const isList = trimmed.charCodeAt(0) === 45

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
			let afterDash = trimmed === '-' ? '' : stripDashPrefix(trimmed)
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
					message: `LIMA: nested block sequence at line ${baseLine + idx}: "${trimmed}"`,
				})
				items.push(builder.null(baseLine + idx))
				idx++
				while (idx < lines.length) {
					const nextIndent = lineIndent(lines[idx])
					if (nextIndent === lines[idx].length || lines[idx].charCodeAt(nextIndent) === 35) { idx++; continue }
					if (nextIndent <= baseIndent) break
					idx++
				}
			} else if (colonPos !== -1) {
				const pendingKey = stripKeyQuotes(afterDash.slice(0, colonPos).trim())
				checkKeyLength(pendingKey, () => baseLine + idx)
				const pendingRaw = afterDash.slice(colonPos + 2).trim()
				pendingItem = builder.createMapping()
				builder.setMapping(pendingItem, pendingKey, parseFlowOrScalarValue(pendingRaw, ctx, baseLine + idx, builder))
				idx++
			} else if (afterDash.endsWith(':')) {
				const itemKey = stripKeyQuotes(afterDash.slice(0, -1).trim())
				const keyLineNum = baseLine + idx
				checkKeyLength(itemKey, () => keyLineNum)
				idx++
				let ni = idx
				while (ni < lines.length && isBlankLine(lines[ni])) ni++
				if (ni < lines.length) {
					const nextIndent = lineIndent(lines[ni])
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder)
						pendingItem = builder.createMapping()
						builder.setMapping(pendingItem, itemKey, nested ?? builder.null(keyLineNum))
						idx = after
						continue
					}
				}
				pendingItem = builder.createMapping()
				builder.setMapping(pendingItem, itemKey, builder.null(keyLineNum))
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
				const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
				checkKeyLength(itemKey, () => baseLine + idx)
				checkDuplicateKey(builder.hasMappingKey(entries, itemKey), itemKey, baseLine + idx, ctx)
				let itemVal = trimmed.slice(colonPos + 2).trim()
				if (itemVal.includes('#')) itemVal = stripComment(itemVal)
				builder.setMapping(entries, itemKey, parseFlowOrScalarValue(itemVal, ctx, baseLine + idx, builder))
				idx++
			} else if (trimmed.endsWith(':')) {
				if (entries === null) entries = builder.createMapping()
				const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
				const keyLineNum = baseLine + idx
				checkKeyLength(itemKey, () => keyLineNum)
				checkDuplicateKey(builder.hasMappingKey(entries, itemKey), itemKey, keyLineNum, ctx)
				idx++
				let ni = idx
				while (ni < lines.length && isBlankLine(lines[ni])) ni++
				if (ni < lines.length) {
					const nextIndent = lineIndent(lines[ni])
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
