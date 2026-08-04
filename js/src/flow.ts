/** Core §15.8 flow collections: `[...]` sequences and `{...}` mappings. */

import { checkKeyLength, checkDuplicateKey, type ParseContext } from './normalize.js'
import { parseQuotedOrTyped, parseScalarValue, stripKeyQuotes } from './scalars.js'
import { LimaError } from './errors.js'
import type { ValueBuilder } from './builder.js'

const splitFlowItems = (inner: string): string[] => {
	const items: string[] = []
	let start = 0
	let quote = 0
	let depth = 0
	for (let i = 0; i < inner.length; i++) {
		const cc = inner.charCodeAt(i)
		if (quote) {
			if (cc === 92) { i++ }
			else if (cc === quote) quote = 0
		} else if (cc === 34 || cc === 39) {
			quote = cc
		} else if (cc === 91 || cc === 123) {
			depth++
		} else if (cc === 93 || cc === 125) {
			depth--
		} else if (cc === 44 && depth === 0) {
			items.push(inner.slice(start, i).trim())
			start = i + 1
		}
	}
	items.push(inner.slice(start).trim())
	return items
}

const isNestedFlowConstruct = (item: string): boolean =>
	(item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) ||
	(item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125)

export const parseFlowSequence = <V, M>(val: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>): V[] | null => {
	if (val.charCodeAt(0) !== 91 || val.charCodeAt(val.length - 1) !== 93) return null
	const inner = val.slice(1, -1).trim()
	if (!inner) return []
	const rawItems = splitFlowItems(inner)

	if (!ctx.strict && rawItems.length > 1 && !rawItems[rawItems.length - 1]) rawItems.pop()

	return rawItems.map((item): V => {
		if (!item) {
			if (ctx.strict) throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `LIMA: empty element in flow sequence at line ${line}` })
			return builder.null(line)
		}
		if (item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) {
			throw new LimaError({
				code: 'INVALID_FLOW_SYNTAX', line,
				message: `LIMA: nested flow sequence not permitted at line ${line}: "${item}"`,
			})
		}
		if (item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125) {
			const nested = parseFlowMapping(item, ctx, line, builder)
			if (nested !== null) return nested
		}
		return parseQuotedOrTyped(item, ctx, line, false, builder)
	})
}

export const parseFlowMapping = <V, M>(val: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>): V | null => {
	if (val.charCodeAt(0) !== 123 || val.charCodeAt(val.length - 1) !== 125) return null
	const inner = val.slice(1, -1).trim()
	const entries = builder.createMapping()
	if (!inner) return builder.mapping(entries, line)
	for (const item of splitFlowItems(inner)) {
		if (!item) {
			if (ctx.strict) throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `LIMA: empty element in flow mapping at line ${line}` })
			continue
		}
		const colonPos = item.indexOf(': ')
		if (colonPos === -1) {
			if (ctx.strict) throw new LimaError({
				code: 'INVALID_FLOW_SYNTAX', line,
				message: `LIMA: invalid flow mapping item (missing ": ") at line ${line}: "${item}"`,
			})
			return null
		}
		const key = stripKeyQuotes(item.slice(0, colonPos).trim())
		checkKeyLength(key, () => line)
		checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx)
		const rawVal = item.slice(colonPos + 2).trim()
		if (isNestedFlowConstruct(rawVal)) {
			throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `LIMA: invalid flow nesting at line ${line}: "${rawVal}"` })
		}
		builder.setMapping(entries, key, parseQuotedOrTyped(rawVal, ctx, line, false, builder))
	}
	return builder.mapping(entries, line)
}

/** Parses a value that may be a flow collection, without probing both flow parsers for ordinary scalars. */
export const parseFlowOrScalarValue = <V, M>(
	raw: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>,
): V => {
	const first = raw.charCodeAt(0)
	if (first === 91) {
		const sequence = parseFlowSequence(raw, ctx, line, builder)
		if (sequence !== null) return builder.array(sequence, line)
	} else if (first === 123) {
		const mapping = parseFlowMapping(raw, ctx, line, builder)
		if (mapping !== null) return mapping
	}
	return parseScalarValue(raw, ctx, line, builder)
}
