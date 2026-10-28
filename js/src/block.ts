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

import { type ParseContext, checkKeyLength, checkDuplicateKey, NESTING_DEPTH_LIMIT } from './normalize.js'
import {
	stripKeyQuotes, stripComment, stripCommentKeepEscapes,
	parseQuotedOrTyped, closingQuoteIndex, isValidKey,
} from './scalars.js'
import { parseFlowOrScalarValue, parseFlowSequence } from './flow.js'
import { buildBlockScalar } from './block-scalar.js'
import { LimaError } from './errors.js'
import type { ValueBuilder } from './builder.js'
import type { ReferenceSource } from './reference-tokens2.js'
import { isTrimWhitespace } from './chars.js'
import { BlockCursor } from './block-cursor.js'

const DASH_PREFIX_RE = /^-\s+/

/**
 * A key's inline value text. If it is exactly `|`, consume the following
 * physical lines belonging to the Core §6.1.5 block scalar introduced by a
 * key at `keyIndent` and return the scalar; the cursor is left on the first
 * line past the scalar. Otherwise parse `raw` as an ordinary inline value
 * and advance one line. §6.1.5 places no top-level restriction on block
 * scalars, so this is the same primitive `core.ts` uses at the top level.
 */
/** Length of the `- ` (dash + whitespace) prefix on the cursor's current line. */
const dashPrefixLen = (cursor: BlockCursor): number => {
	const start = cursor.contentStart, end = cursor.lineEnd
	if (start + 1 === end) return 1
	let content = start + 1
	while (content < end && isTrimWhitespace(cursor.source.charCodeAt(content))) content++
	return content - start
}

/** Codepoints of leading whitespace on `s` — for a value's column within its line. */
const leadingWsLen = (s: string): number => s.length - s.trimStart().length

/** A value's physical `raw` for References 2.0 token positions: a trailing
 * `#` comment removed (its `${…}`-shaped text is not part of the value, so
 * must not be scanned), but `\#` kept as written (§2.4 — a `\#` before a
 * token still occupies two source columns). */
const physicalRaw = (s: string): string => (s.includes('#') ? stripCommentKeepEscapes(s) : s)

/** The `ReferenceSource` for an inline value on line `keyLine` at column
 * `valueCol`; `rawUndecoded` is the value text before comment stripping /
 * `\#` collapse (so a `\#` before a token doesn't shift its column). */
const inlineSource = (
	wantSource: boolean, ctx: ParseContext, keyLine: number, valueCol: number, rawUndecoded: string,
): ReferenceSource | undefined => wantSource ? ({
	raw: physicalRaw(rawUndecoded), line: keyLine, col: valueCol,
	tabAdjust: ctx.tabAdjust ? [ctx.tabAdjust[keyLine - 1] ?? 0] : undefined,
}) : undefined

/** An inline value, or a `|` block scalar when `marker`: the value is `|` alone (§6.1.5; `| # c` is the string `|`). */
const inlineOrBlockScalar = <V, M>(
	raw: string, marker: boolean, keyIndent: number, keyLine: number, valueCol: number, rawUndecoded: string,
	cursor: BlockCursor, ctx: ParseContext, builder: ValueBuilder<V, M>,
): V => {
	const wantSource = builder.positions === true
	if (!marker) {
		const value = parseFlowOrScalarValue(
			raw, ctx, keyLine, builder, inlineSource(wantSource, ctx, keyLine, valueCol, rawUndecoded),
		)
		cursor.next()
		return value
	}
	cursor.next() // past the `key: |` line
	const bodyLines: string[] = []
	while (cursor.valid) {
		// the scalar's own extent (§6.1.5, `buildBlockScalar`): a line of spaces only is empty, any other ends it at the
		// key's column or less — a line of other whitespace too, which is content here
		if (cursor.lineEnd - cursor.lineStart > cursor.asciiIndent && cursor.asciiIndent <= keyIndent) break
		bodyLines.push(cursor.source.slice(cursor.lineStart, cursor.lineEnd))
		cursor.next()
	}
	return buildBlockScalar(bodyLines, keyIndent, keyLine, ctx, builder).value
}

export const findKeySep = (s: string): number => {
	const first = s.charCodeAt(0)
	if (first === 39 || first === 34) {
		// §5.1: the `: ` separator must sit outside the quoted key, so scan
		// past its closing quote first. Double-quoted keys honour `\"`; a
		// single-quoted key is literal (§5.2), so its first `'` closes.
		const close = closingQuoteIndex(s, false)
		if (close !== -1 && s.charCodeAt(close + 1) === 58 && s.charCodeAt(close + 2) === 32) return close + 1
		return -1
	}
	return s.indexOf(': ')
}

/**
 * Recursively parses a block value from a mutable physical-line cursor over
 * the original source. Strings are materialized only when grammar or scalar
 * parsing needs their content.
 */
/**
 * `source.slice(start, end).trimEnd()`: a key, or a line's content, keeps the whitespace it starts with, which makes it
 * no key (Core 1.1 §7.1: other whitespace before content is no indentation).
 */
const trimEndSlice = (source: string, start: number, end: number): string => {
	while (end > start && isTrimWhitespace(source.charCodeAt(end - 1))) end--
	return source.slice(start, end)
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

const cursorContent = (cursor: BlockCursor): string =>
	cursor.source.slice(cursor.contentStart, cursor.lineEnd)

/**
 * Core §4 rule 7 / §6.1.3: comment lines (first non-whitespace character
 * `#`) do not affect base indentation and are skipped — including in the
 * lookahead that decides whether a bare key (`key:` with no inline value)
 * has any nested block at all. Advancing past a comment here, not only a
 * blank line, keeps that pre-check consistent with the same skip already
 * applied once inside an established block (`parseCursorBlock`'s own
 * `cursor.empty || cursor.firstCode === 35` check at the top of its loop).
 */
const skipEmptyAndCommentLines = (cursor: BlockCursor): void => {
	while (cursor.valid && (cursor.empty || cursor.firstCode === 35)) cursor.next()
}

/**
 * §7.2: a sequence item is a line of `-` alone or `-` followed by whitespace; `---` or `-x` is none (Core 1.1). The
 * cursor is on a line with content.
 */
const isSequenceItem = (cursor: BlockCursor): boolean => {
	if (cursor.firstCode !== 45) return false
	const next = cursor.contentStart + 1
	return next === cursor.lineEnd || isTrimWhitespace(cursor.source.charCodeAt(next))
}

/**
 * Core 1.1 §7.2: the block of a bare key at `keyColumn` — deeper than the key (§7.1 rule 3), or a sequence that
 * starts at the key's own column, which `compact` parsing ends at that column's first line that is no item. Null
 * without either. The cursor is on the first content line after the key.
 */
const blockOfBareKey = <V, M>(
	cursor: BlockCursor, keyColumn: number, ctx: ParseContext, baseLine: number, builder: ValueBuilder<V, M>,
): V | null => {
	if (!cursor.valid) return null
	if (cursor.indent > keyColumn) return parseCursorBlock(cursor, cursor.indent, ctx, baseLine, builder)
	if (cursor.indent === keyColumn && isSequenceItem(cursor))
		return parseCursorBlock(cursor, keyColumn, ctx, baseLine, builder, true)
	return null
}

const cursorAfterDash = (cursor: BlockCursor): string => {
	const start = cursor.contentStart
	const end = cursor.lineEnd
	if (start + 1 === end) return ''
	let content = start + 1
	if (!isTrimWhitespace(cursor.source.charCodeAt(content))) return cursor.source.slice(start, end)
	while (content < end && isTrimWhitespace(cursor.source.charCodeAt(content))) content++
	return cursor.source.slice(content, end)
}

/** Core 1.1 §10.1: a line in a block whose key the key grammar (§5.1) rejects, in strict mode. */
const unrecognizedKeyLine = (line: number, trimmed: string): LimaError => new LimaError({
	code: 'UNRECOGNIZED_LINE', line,
	message: `Lima: unrecognised line at line ${line}: "${trimmed}" (an unquoted key has letters, digits, "_", "-" and ":" only; quote any other)`,
})

/** Shared block grammar consuming one mutable physical-line cursor. */
const parseCursorBlock = <V, M>(
	cursor: BlockCursor, baseIndent: number, ctx: ParseContext, baseLine: number,
	builder: ValueBuilder<V, M>, compact = false,
): V | null => {
	const wantSource = builder.positions === true
	let items: V[] | null = null
	let entries: M | null = null
	let pendingItem: M | null = null
	// the column of the pending object item's keys: its first key's, after `- ` (§7.2)
	let pendingColumn = 0
	const startLine = cursor.lineIndex

	while (cursor.valid) {
		const line = baseLine + cursor.lineIndex
		if (cursor.empty || cursor.firstCode === 35) { cursor.next(); continue }
		const indent = cursor.indent
		if (indent < baseIndent) break

		if (indent > baseIndent) {
			const trimmed = cursorContent(cursor)
			// §7.2: an object item's keys stand at its first key's column. A line less indented ends the item (§7.1
			// rule 4); a deeper one, which no nested block took, is inconsistently indented (rule 5) and the item goes on
			if (pendingItem !== null && indent < pendingColumn) {
				items!.push(builder.mapping(pendingItem, line)); pendingItem = null
			}
			if (pendingItem !== null && indent > pendingColumn) {
				if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
					message: `Lima: unexpected indentation at line ${line}: "${trimmed}"` })
				cursor.next(); continue
			}
			if (items !== null && pendingItem !== null) {
				const bareKey = trimmed.charCodeAt(trimmed.length - 1) === 58
				const colonPos = bareKey && trimmed.indexOf(' ') === -1 ? -1 : findKeySep(trimmed)
				const keyRaw = colonPos !== -1
					? trimEndSlice(trimmed, 0, colonPos)
					: bareKey ? trimEndSlice(trimmed, 0, trimmed.length - 1) : ''
				if (keyRaw !== '' && !isValidKey(keyRaw)) {
					// §5.1: not a usable key — an unrecognised line, skipped in non-strict mode and an error in strict
					// mode, as at the top level (Core 1.1 §10.1)
					if (ctx.strict) throw unrecognizedKeyLine(line, trimmed)
					cursor.next()
				} else if (colonPos !== -1) {
					const key = stripKeyQuotes(keyRaw, ctx.strict, line)
					checkKeyLength(key, line)
					const rawUndecoded = trimSlice(trimmed, colonPos + 2, trimmed.length)
					let raw = rawUndecoded
					if (raw !== '|' && raw.includes('#')) raw = stripComment(raw)
					const valueCol = wantSource ? cursor.indent + colonPos + 2 + leadingWsLen(trimmed.slice(colonPos + 2)) : 0
					builder.setMapping(pendingItem, key, inlineOrBlockScalar(raw, rawUndecoded === '|', indent, line, valueCol, rawUndecoded, cursor, ctx, builder))
				} else if (bareKey) {
					const key = stripKeyQuotes(keyRaw, ctx.strict, line)
					checkKeyLength(key, line)
					cursor.next()
					skipEmptyAndCommentLines(cursor)
					const nested = blockOfBareKey(cursor, indent, ctx, baseLine, builder)
					builder.setMapping(pendingItem, key, nested ?? builder.null(line))
				} else {
					if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
						message: `Lima: unexpected syntax in array item continuation at line ${line}: "${trimmed}"` })
					cursor.next()
				}
			} else {
				if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
					message: `Lima: unexpected indentation at line ${line}: "${trimmed}"` })
				cursor.next()
			}
			continue
		}

		// a sequence at its key's column ends at that column's first line that is no item (Core 1.1 §7.2)
		if (compact && !isSequenceItem(cursor)) break
		if (isSequenceItem(cursor)) {
			if (pendingItem !== null) {
				items!.push(builder.mapping(pendingItem, line)); pendingItem = null
			}
			// a block is a mapping or a sequence, as its first line decides; in non-strict mode a line of the other kind
			// is skipped, and what the block holds stays (Core 1.1 §7.1)
			if (entries !== null) {
				if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
					message: `Lima: mixed array and map entries for the same key at line ${line}` })
				cursor.next(); continue
			}
			if (items === null) items = []

			const afterDashRaw = cursorAfterDash(cursor)
			let afterDash = afterDashRaw
			if (afterDash.includes('#')) afterDash = stripComment(afterDash)
			const afterDashCol = wantSource ? cursor.indent + dashPrefixLen(cursor) : 0
			const afterDashTab = wantSource && ctx.tabAdjust ? [ctx.tabAdjust[line - 1] ?? 0] : undefined
			const dashSource: ReferenceSource | undefined = wantSource ? ({
				raw: physicalRaw(afterDashRaw), line, col: afterDashCol, tabAdjust: afterDashTab,
			}) : undefined
			const first = afterDash.charCodeAt(0)
			// an item's value is an inline value (§15.3): a flow mapping, or what an unclosed one falls back to (§7.5); a
			// flow sequence there is a sequence in a sequence (§7.2)
			if (first === 123) {
				items.push(parseFlowOrScalarValue(afterDash, ctx, line, builder, dashSource))
				cursor.next(); continue
			}
			if (first === 91) {
				const sequence = parseFlowSequence(afterDash, ctx, line, builder, dashSource)
				if (sequence === null) items.push(parseFlowOrScalarValue(afterDash, ctx, line, builder, dashSource))
				else if (ctx.strict) throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line,
					message: `Lima: nested sequence at line ${line}: "${cursorContent(cursor)}"` })
				else items.push(builder.null(line))
				cursor.next(); continue
			}
			if (first !== 34 && first !== 39 && first !== 45 &&
				afterDash.indexOf(': ') === -1 && !afterDash.endsWith(':')) {
				items.push(parseQuotedOrTyped(afterDash, ctx, line, builder, dashSource))
				cursor.next(); continue
			}
			const colonPos = findKeySep(afterDash)
			if (afterDash === '-' || DASH_PREFIX_RE.test(afterDash)) {
				if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
					message: `Lima: nested block sequence at line ${line}: "${cursorContent(cursor)}"` })
				items.push(builder.null(line)); cursor.next()
				while (cursor.valid) {
					if (cursor.empty || cursor.source.charCodeAt(cursor.contentStart) === 35) { cursor.next(); continue }
					if (cursor.indent <= baseIndent) break
					cursor.next()
				}
			} else if (colonPos !== -1 && isValidKey(trimSlice(afterDash, 0, colonPos))) {
				const keyRaw = trimSlice(afterDash, 0, colonPos)
				const key = stripKeyQuotes(keyRaw, ctx.strict, line)
				checkKeyLength(key, line)
				const valueStart = colonPos + 2
				const valueFirst = afterDash.charCodeAt(valueStart)
				const valueLast = afterDash.charCodeAt(afterDash.length - 1)
				const raw = valueFirst > 0x20 && valueFirst < 0x7f && valueLast > 0x20 && valueLast < 0x7f
					? afterDash.slice(valueStart) : trimSlice(afterDash, valueStart, afterDash.length)
				// The key sits after `- `, two columns past the dash.
				const valueCol = wantSource ? afterDashCol + valueStart + leadingWsLen(afterDash.slice(valueStart)) : 0
				pendingColumn = cursor.indent + dashPrefixLen(cursor)
				pendingItem = builder.createMappingWith(key,
					inlineOrBlockScalar(raw, trimSlice(afterDashRaw, valueStart, afterDashRaw.length) === '|', baseIndent + 2, line, valueCol,
						wantSource ? afterDashRaw.slice(valueStart) : raw, cursor, ctx, builder))
				// the item's later keys at its key column; any other line is the block loop's (§7.2)
				while (cursor.valid && cursor.indent === pendingColumn) {
					const continuationLine = baseLine + cursor.lineIndex
					const ckeyIndent = cursor.asciiIndent
					const cfirst = cursor.source.charCodeAt(cursor.contentStart)
					if (cfirst === 35) break
					const contLine = trimEndSlice(cursor.source, cursor.contentStart, cursor.lineEnd)
					const csep = findKeySep(contLine)
					if (csep === -1) break
					const ckeyRaw = trimEndSlice(contLine, 0, csep)
					if (!isValidKey(ckeyRaw)) break
					const ckey = stripKeyQuotes(ckeyRaw, ctx.strict, continuationLine)
					if (!ckey) break
					checkKeyLength(ckey, continuationLine)
					const valueUndecoded = trimSlice(contLine, csep + 2, contLine.length)
					let value = valueUndecoded
					if (value !== '|' && value.includes('#')) value = stripComment(value)
					// contLine starts exactly at contentStart (no leading trim), so
					// the value's column is the indent plus its offset in contLine.
					const cValueCol = wantSource ? cursor.indent + csep + 2 + leadingWsLen(contLine.slice(csep + 2)) : 0
					builder.setMapping(pendingItem, ckey,
						inlineOrBlockScalar(value, valueUndecoded === '|', ckeyIndent, continuationLine, cValueCol, valueUndecoded, cursor, ctx, builder))
				}
			} else if (afterDash.endsWith(':') && isValidKey(trimSlice(afterDash, 0, afterDash.length - 1))) {
				const key = stripKeyQuotes(trimSlice(afterDash, 0, afterDash.length - 1), ctx.strict, line)
				checkKeyLength(key, line)
				// §7.1 rule 3 / §7.2: sibling keys of an object item align at
				// the column of the first key *after* `- `; a nested block
				// must be indented deeper than that column, not merely deeper
				// than the item's dash. A line at the key's own column is the
				// next sibling key, so the bare key is `null`.
				let keyColumn = cursor.contentStart + 1
				while (keyColumn < cursor.lineEnd && isTrimWhitespace(cursor.source.charCodeAt(keyColumn))) keyColumn++
				keyColumn -= cursor.lineStart
				cursor.next()
				skipEmptyAndCommentLines(cursor)
				const nested = blockOfBareKey(cursor, keyColumn, ctx, baseLine, builder)
				pendingColumn = keyColumn
				pendingItem = builder.createMappingWith(key, nested ?? builder.null(line))
			} else {
				// A quoted-or-typed scalar item — parseQuotedOrTyped enforces
				// §10.1's unterminated / trailing-content strict checks.
				items.push(parseQuotedOrTyped(afterDash, ctx, line, builder, dashSource))
				cursor.next()
			}
		} else {
			const trimmed = cursorContent(cursor)
			if (items !== null) {
				if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
					message: `Lima: mixed map and array entries for the same key at line ${line}` })
				cursor.next(); continue
			}
			const bareKey = trimmed.charCodeAt(trimmed.length - 1) === 58
			const colonPos = bareKey && trimmed.indexOf(' ') === -1 ? -1 : findKeySep(trimmed)
			const keyRaw = colonPos !== -1
				? trimEndSlice(trimmed, 0, colonPos)
				: bareKey ? trimEndSlice(trimmed, 0, trimmed.length - 1) : ''
			if (keyRaw !== '' && !isValidKey(keyRaw)) {
				// §5.1: not a usable key — an unrecognised line, skipped in non-strict mode and an error in strict
				// mode, as at the top level (Core 1.1 §10.1)
				if (ctx.strict) throw unrecognizedKeyLine(line, trimmed)
				cursor.next()
			} else if (colonPos !== -1) {
				if (entries === null) entries = builder.createMapping()
				const key = stripKeyQuotes(keyRaw, ctx.strict, line)
				checkKeyLength(key, line)
				if (ctx.strict || ctx.onWarning !== undefined)
					checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx)
				const rawUndecoded = trimSlice(trimmed, colonPos + 2, trimmed.length)
				let raw = rawUndecoded
				if (raw !== '|' && raw.includes('#')) raw = stripComment(raw)
				const valueCol = wantSource ? cursor.indent + colonPos + 2 + leadingWsLen(trimmed.slice(colonPos + 2)) : 0
				builder.setMapping(entries, key, inlineOrBlockScalar(raw, rawUndecoded === '|', baseIndent, line, valueCol, rawUndecoded, cursor, ctx, builder))
			} else if (bareKey) {
				if (entries === null) entries = builder.createMapping()
				const key = stripKeyQuotes(keyRaw, ctx.strict, line)
				checkKeyLength(key, line)
				if (ctx.strict || ctx.onWarning !== undefined)
					checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx)
				cursor.next()
				skipEmptyAndCommentLines(cursor)
				const nested = blockOfBareKey(cursor, baseIndent, ctx, baseLine, builder)
				builder.setMapping(entries, key, nested ?? builder.null(line))
			} else {
				if (ctx.strict) throw new LimaError({ code: 'INVALID_INDENTATION', line,
					message: `Lima: indented freetext without a block scalar marker at line ${line}: "${trimmed}"` })
				cursor.next()
			}
		}
	}
	if (pendingItem !== null) items!.push(builder.mapping(pendingItem, baseLine + startLine))
	return items !== null ? builder.array(items, baseLine + startLine) :
		entries !== null ? builder.mapping(entries, baseLine + startLine) : null
}

/** Complete block grammar over one UTF-16 source range. */
export type BlockDepthRisk = { mayExceed: boolean }

export const parseBlockRange = <V, M>(
	source: string, start: number, end: number, ctx: ParseContext, baseLine: number,
	builder: ValueBuilder<V, M>, depthRisk: BlockDepthRisk,
): V | null => {
	const cursor = new BlockCursor(source, start, end)
	if (!cursor.next()) return null
	skipEmptyAndCommentLines(cursor)
	if (!cursor.valid) return null
	const baseIndent = cursor.asciiIndent
	// Core 1.1 §7.2: at the top level's own column 0 only a sequence is the key's block; any other first line is not
	if (baseIndent === 0 && !isSequenceItem(cursor)) return null
	const value = parseCursorBlock(cursor, baseIndent, ctx, baseLine, builder, baseIndent === 0)
	// Recursive block containers require strictly increasing integer
	// indentation. At one indentation level a sequence-item mapping can add
	// one container and Core flow syntax at most two more, so delta + 4 is a
	// conservative depth bound below the document root.
	if (cursor.maxIndent - baseIndent + 4 > NESTING_DEPTH_LIMIT) depthRisk.mayExceed = true
	return value
}
