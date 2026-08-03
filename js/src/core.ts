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
 */

import { type LimaValue, LNull, LBool, LFloat, LInt, LString, LInstant } from './value'

type Meta = Record<string, any>

/** Every Lima mapping result must be a prototype-free object (Core §11.1). */
const emptyMapping = (): Meta => Object.create(null)

export type PositionedValue =
	| { kind: 'null'; line: number }
	| { kind: 'bool'; value: boolean; line: number }
	| { kind: 'int'; value: number; line: number }
	| { kind: 'float'; value: number; line: number }
	| { kind: 'string'; value: string; line: number; quoted: boolean }
	| { kind: 'instant'; value: Date; line: number }
	| { kind: 'array'; items: PositionedValue[]; line: number }
	| { kind: 'mapping'; entries: Map<string, PositionedValue>; line: number }

const withPos = (v: LimaValue, line: number): PositionedValue => {
	switch (v.kind) {
		case 'null': return { kind: 'null', line }
		case 'bool': return { kind: 'bool', value: v.value, line }
		case 'int': return { kind: 'int', value: v.value, line }
		case 'float': return { kind: 'float', value: v.value, line }
		case 'string': return { kind: 'string', value: v.value, line, quoted: false }
		case 'instant': return { kind: 'instant', value: v.value, line }
		case 'array': return { kind: 'array', items: v.items.map((i) => withPos(i, line)), line }
		case 'mapping': {
			const entries = new Map<string, PositionedValue>()
			for (const [k, c] of v.entries) entries.set(k, withPos(c, line))
			return { kind: 'mapping', entries, line }
		}
	}
}

/** Strips position/quoted-origin annotations, recursively — the public parseCore() projection. */
export const toPlainValue = (v: PositionedValue): LimaValue => {
	switch (v.kind) {
		case 'null': return LNull
		case 'bool': return LBool(v.value)
		case 'int': return LInt(v.value)
		case 'float': return LFloat(v.value)
		case 'string': return LString(v.value)
		case 'instant': return LInstant(v.value)
		case 'array': return { kind: 'array', items: v.items.map(toPlainValue) }
		case 'mapping': {
			const entries = new Map<string, LimaValue>()
			for (const [k, c] of v.entries) entries.set(k, toPlainValue(c))
			return { kind: 'mapping', entries }
		}
	}
}

const depthOfPositioned = (v: PositionedValue): number => {
	if (v.kind === 'array') return v.items.length === 0 ? 1 : 1 + Math.max(...v.items.map(depthOfPositioned))
	if (v.kind === 'mapping') {
		const children = [...v.entries.values()]
		return children.length === 0 ? 1 : 1 + Math.max(...children.map(depthOfPositioned))
	}
	return 0
}

// ─── Precompiled regexes ──────────────────────────────────────────────────────

// See the historical implementation notes carried over from the legacy
// parser: ASCII-only key grammar (frontmatter keys are always ASCII),
// \r/\t excluded from the separator group because parse() normalizes first.
const KEY_RE = /^(?:([a-zA-Z\d_][a-zA-Z\d_:-]*)|'([^']*)'|"((?:[^"\\]|\\.)*)"):( *\n| )/gm
const SPACE_BEFORE_COLON_RE = /^(?:'[^']*'|"(?:[^"\\]|\\.)*")[ \t]+:/
const ESCAPED_HASH_RE = /\\#/g
const DATE_PRE_RE = /\d[\d\-:.\/a-zA-Z]{4,}/
const DASH_PREFIX_RE = /^-\s+/
const ANY_ESCAPE_RE = /\\(u[0-9a-fA-F]{0,4}|U[0-9a-fA-F]{0,8}|x[0-9a-fA-F]{0,2}|.)/gs
const SINGLE_CHAR_ESCAPES = '"\\/bfnrt' // deliberately excludes '0' — Core Appendix A: \0 is unknown, not a null shorthand.
const U_ESCAPE_RE = /^u([0-9a-fA-F]{4})$/
const CAP_U_ESCAPE_RE = /^U([0-9a-fA-F]{8})$/
const X_ESCAPE_RE = /^x([0-9a-fA-F]{2})$/

const isValidEscape = (escape: string): boolean => {
	if (escape.length === 1) return SINGLE_CHAR_ESCAPES.includes(escape)
	const u = escape.match(U_ESCAPE_RE)
	if (u) {
		const cp = parseInt(u[1], 16)
		return cp < 0xd800 || cp > 0xdfff
	}
	const bigU = escape.match(CAP_U_ESCAPE_RE)
	if (bigU) return parseInt(bigU[1], 16) <= 0x10ffff
	return X_ESCAPE_RE.test(escape)
}

// Core §9 resource limits. All are hard errors in both modes.
export const SCALAR_LENGTH_LIMIT = 16384
const DOCUMENT_SIZE_LIMIT = 65536
const KEY_LENGTH_LIMIT = 128
const TOP_LEVEL_KEY_LIMIT = 128
export const NESTING_DEPTH_LIMIT = 16

const utf8Encoder = new TextEncoder()
const byteLength = (s: string): number => utf8Encoder.encode(s).length

const checkScalarLimit = (v: LimaValue, line: number): void => {
	if (v.kind === 'string' && [...v.value].length > SCALAR_LENGTH_LIMIT) {
		throw new Error(`LIMA: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${line}`)
	}
}

const checkKeyLength = (key: string, line: number): void => {
	if ([...key].length > KEY_LENGTH_LIMIT) {
		throw new Error(`LIMA: key "${key}" exceeds maximum length of ${KEY_LENGTH_LIMIT} code points at line ${line}`)
	}
}

const checkDuplicateKeyMap = (entries: Map<string, unknown>, key: string, line: number, strict: boolean): void => {
	if (!entries.has(key)) return
	const msg = `LIMA: duplicate key "${key}" at line ${line} — last value wins`
	if (strict) throw new Error(msg)
	console.warn(msg)
}

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

// ─── Dates ──────────────────────────────────────────────────────────────────

const ISO_DATE_RE    = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/
const GERMAN_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/
const SLASH_DATE_RE  = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInMonth = (y: number, m: number): number => (m === 2 && isLeapYear(y)) ? 29 : DAYS_IN_MONTH[m - 1]

const parseDateUTC = (str: string, strict = false, line = 0): Date | null => {
	const invalid = (): null => {
		if (strict) throw new Error(`LIMA: invalid date "${str}" at line ${line}`)
		return null
	}

	let y: number, mo: number, d: number, h = 0, mi = 0, s = 0, offsetMin = 0

	const iso = ISO_DATE_RE.exec(str)
	const german = !iso ? GERMAN_DATE_RE.exec(str) : null
	const slash = !iso && !german ? SLASH_DATE_RE.exec(str) : null

	if (iso) {
		y = +iso[1]; mo = +iso[2]; d = +iso[3]
		h = iso[4] !== undefined ? +iso[4] : 0
		mi = iso[5] !== undefined ? +iso[5] : 0
		s = iso[6] !== undefined ? +iso[6] : 0
		const offsetStr = iso[7]
		if (offsetStr && offsetStr !== 'Z') {
			const sign = offsetStr.charCodeAt(0) === 45 ? -1 : 1
			const oh = +offsetStr.slice(1, 3)
			const om = +offsetStr.slice(4, 6)
			if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return invalid()
			offsetMin = sign * (oh * 60 + om)
		}
	} else if (german) {
		d = +german[1]; mo = +german[2]; y = +german[3]
		h = german[4] !== undefined ? +german[4] : 0
		mi = german[5] !== undefined ? +german[5] : 0
		s = german[6] !== undefined ? +german[6] : 0
	} else if (slash) {
		y = +slash[1]; mo = +slash[2]; d = +slash[3]
		h = slash[4] !== undefined ? +slash[4] : 0
		mi = slash[5] !== undefined ? +slash[5] : 0
		s = slash[6] !== undefined ? +slash[6] : 0
	} else {
		return null
	}

	if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) ||
		h > 23 || mi > 59 || s > 59) return invalid()

	const base = new Date(0)
	base.setUTCFullYear(y, mo - 1, d)
	base.setUTCHours(h, mi, s, 0)
	const result = new Date(base.getTime() - offsetMin * 60000)

	const utcYear = result.getUTCFullYear()
	if (utcYear < 1 || utcYear > 9999) return invalid()

	return result
}

// ─── Numbers ────────────────────────────────────────────────────────────────

const NUMBER_RE = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/
const isFloatForm = (str: string): boolean => str.includes('.') || str.includes('e') || str.includes('E')
const isZeroLiteral = (str: string): boolean => /^0+(\.0+)?$/.test(str.replace(/^-/, '').split(/[eE]/)[0])

/**
 * Converts a raw token to its Lima value, per Core §6.4.1's explicit number
 * grammar (never `Number()`/`parseFloat()`, which accept far more than Lima
 * does) and the three §6.5.1 date shapes. Reference-shaped text (`($key)`,
 * `(%key)`) matches none of these and falls through to a plain string,
 * unrecognised and unresolved — Core has no concept of it at all.
 */
const toType = (str: string, strict = false, line = 0): LimaValue => {
	if (str === '' || str === 'null' || str === '~') return LNull
	if (str === 'true') return LBool(true)
	if (str === 'false') return LBool(false)
	// Hex (0x/0X), octal (0o/0O), binary (0b/0B) — kept as strings (YAML 1.2 compatible).
	if (str.length > 2 && str.charCodeAt(0) === 48 &&
		(str.charCodeAt(1) === 120 || str.charCodeAt(1) === 88 ||
		 str.charCodeAt(1) === 111 || str.charCodeAt(1) === 79 ||
		 str.charCodeAt(1) === 98  || str.charCodeAt(1) === 66)) return LString(str)
	if (NUMBER_RE.test(str)) {
		const n = Number(str)
		if (isFloatForm(str)) {
			if (!Number.isFinite(n)) {
				if (strict) throw new Error(`LIMA: float value overflows to a non-finite value at line ${line}: "${str}"`)
			} else if (n === 0 && !isZeroLiteral(str)) {
				if (strict) throw new Error(`LIMA: non-zero float value underflows to zero at line ${line}: "${str}"`)
			} else {
				return LFloat(n)
			}
		} else if (Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
			return LInt(n)
		}
		// Outside the safe integer range, or overflow/underflow already
		// handled above in non-strict mode: fall through to string.
	}
	if (!str.includes('@') && DATE_PRE_RE.test(str)) {
		const date = parseDateUTC(str, strict, line)
		if (date !== null) return LInstant(date)
	}
	return LString(str)
}

// ─── Scalar / quoting ──────────────────────────────────────────────────────

const unescapeDQ = (s: string, strict = false, line = 0): string => {
	if (!s.includes('\\')) return s
	if (strict) {
		for (const m of s.matchAll(ANY_ESCAPE_RE)) {
			if (!isValidEscape(m[0].slice(1))) {
				throw new Error(`LIMA: unknown escape sequence "${m[0]}" at line ${line}`)
			}
		}
	}
	return s.replace(ANY_ESCAPE_RE, (full) => {
		const e = full.slice(1)
		if (!isValidEscape(e)) return full
		switch (e[0]) {
			case '"':  return '"'
			case '\\': return '\\'
			case '/':  return '/'
			case 'b':  return '\b'
			case 'f':  return '\f'
			case 'n':  return '\n'
			case 'r':  return '\r'
			case 't':  return '\t'
			case 'u':  return String.fromCharCode(parseInt(e.slice(1), 16))
			case 'U':  return String.fromCodePoint(parseInt(e.slice(1), 16))
			case 'x':  return String.fromCharCode(parseInt(e.slice(1), 16))
			default:   return full
		}
	})
}

const stripComment = (val: string): string => {
	let quote = 0
	for (let i = 0; i < val.length; i++) {
		const cc = val.charCodeAt(i)
		if (quote) {
			if (cc === 92) i++
			else if (cc === quote) quote = 0
		} else if (cc === 34 || cc === 39) {
			quote = cc
		} else if (cc === 92 && val.charCodeAt(i + 1) === 35) {
			i++
		} else if (cc === 35) {
			return val.slice(0, i).trimEnd().replace(ESCAPED_HASH_RE, '#')
		}
	}
	return val.replace(ESCAPED_HASH_RE, '#')
}

/**
 * Quoted-or-typed scalar, shared by every value position (top-level inline
 * values, flow-sequence/flow-mapping items, block-array scalar items).
 * `topLevel` gates two checks that only apply at the outermost resolveValue
 * call site in the legacy parser and are deliberately not extended to flow
 * items here, to keep this a faithful behavioral port: the "unclosed flow
 * bracket" throw and the "non-whitespace after closing quote" strict throw.
 */
const parseQuotedOrTyped = (raw: string, strict: boolean, line: number, topLevel: boolean): PositionedValue => {
	const first = raw.charCodeAt(0)
	if (first === 34 || first === 39) {
		if (raw.charCodeAt(raw.length - 1) === first) {
			const unquoted = raw.slice(1, -1)
			const value = first === 34 ? unescapeDQ(unquoted, strict, line) : unquoted.replace(/\\'/g, "'")
			checkScalarLimit(LString(value), line)
			return { kind: 'string', value, line, quoted: true }
		}
		if (topLevel && strict) {
			throw new Error(`LIMA: non-whitespace content after closing quote at line ${line}`)
		}
	}
	const typed = toType(raw, strict, line)
	checkScalarLimit(typed, line)
	return withPos(typed, line)
}

const parseScalarValue = (raw: string, strict: boolean, line: number): PositionedValue => {
	const first = raw.charCodeAt(0)
	if (strict && (first === 91 || first === 123)) {
		throw new Error(`LIMA: unclosed flow ${first === 91 ? 'sequence' : 'mapping'} at line ${line}`)
	}
	return parseQuotedOrTyped(raw, strict, line, true)
}

// ─── Flow sequence / mapping ────────────────────────────────────────────────

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

const parseFlowSequence = (val: string, strict: boolean, line: number): PositionedValue[] | null => {
	if (val.charCodeAt(0) !== 91 || val.charCodeAt(val.length - 1) !== 93) return null
	const inner = val.slice(1, -1).trim()
	if (!inner) return []
	const rawItems = splitFlowItems(inner)

	if (!strict && rawItems.length > 1 && !rawItems[rawItems.length - 1]) rawItems.pop()

	return rawItems.map((item): PositionedValue => {
		if (!item) {
			if (strict) throw new Error(`LIMA: empty element in flow sequence at line ${line}`)
			return { kind: 'null', line }
		}
		if (item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) {
			throw new Error(`LIMA: nested flow sequence not permitted at line ${line}: "${item}"`)
		}
		if (item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125) {
			const nested = parseFlowMapping(item, strict, line)
			if (nested !== null) return nested
		}
		return parseQuotedOrTyped(item, strict, line, false)
	})
}

const parseFlowMapping = (val: string, strict: boolean, line: number): PositionedValue | null => {
	if (val.charCodeAt(0) !== 123 || val.charCodeAt(val.length - 1) !== 125) return null
	const inner = val.slice(1, -1).trim()
	const entries = new Map<string, PositionedValue>()
	if (!inner) return { kind: 'mapping', entries, line }
	for (const item of splitFlowItems(inner)) {
		if (!item) {
			if (strict) throw new Error(`LIMA: empty element in flow mapping at line ${line}`)
			continue
		}
		const colonPos = item.indexOf(': ')
		if (colonPos === -1) {
			if (strict) throw new Error(`LIMA: invalid flow mapping item (missing ": ") at line ${line}: "${item}"`)
			return null
		}
		const key = stripKeyQuotes(item.slice(0, colonPos).trim())
		checkKeyLength(key, line)
		checkDuplicateKeyMap(entries, key, line, strict)
		const rawVal = item.slice(colonPos + 2).trim()
		if (isNestedFlowConstruct(rawVal)) {
			throw new Error(`LIMA: invalid flow nesting at line ${line}: "${rawVal}"`)
		}
		entries.set(key, parseQuotedOrTyped(rawVal, strict, line, false))
	}
	return { kind: 'mapping', entries, line }
}

// ─── Block parser ─────────────────────────────────────────────────────────────

const findKeySep = (s: string): number => {
	const first = s.charCodeAt(0)
	if (first === 39 || first === 34) {
		let i = 1
		while (i < s.length && s.charCodeAt(i) !== first) i++
		if (s.charCodeAt(i + 1) === 58 && s.charCodeAt(i + 2) === 32) return i + 1
		return -1
	}
	return s.indexOf(': ')
}

const stripKeyQuotes = (s: string): string => {
	const f = s.charCodeAt(0)
	if (f === 39 && s.charCodeAt(s.length - 1) === 39) return s.slice(1, -1)
	if (f === 34 && s.charCodeAt(s.length - 1) === 34) return unescapeDQ(s.slice(1, -1))
	return s
}

/**
 * Recursively parses a block value (array or mapping) from an array of
 * lines — a direct structural port of the legacy block parser, with every
 * value position now producing a `PositionedValue` instead of a raw JS
 * value, and with no reference-resolution concerns at all (no `resolve()`
 * call anywhere, no array-as-sequence-item reference-shape check — that
 * error class cannot occur here since Core never resolves a reference in
 * the first place).
 */
const parseBlock = (
	lines: string[],
	startIdx: number,
	baseIndent: number,
	strict: boolean,
	baseLine: number,
): { value: PositionedValue | null; nextIdx: number } => {
	let items: PositionedValue[] | null = null
	let entries: Map<string, PositionedValue> | null = null
	let pendingItem: Map<string, PositionedValue> | null = null
	let idx = startIdx

	while (idx < lines.length) {
		const line    = lines[idx]
		const trimmed = line.trimStart()
		if (!trimmed) { idx++; continue }
		if (trimmed.charCodeAt(0) === 35) { idx++; continue }

		const indent = line.length - trimmed.length

		if (indent < baseIndent) break

		if (indent > baseIndent) {
			if (items !== null && pendingItem !== null) {
				const colonPos = findKeySep(trimmed)
				if (colonPos !== -1) {
					const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
					checkKeyLength(itemKey, baseLine + idx)
					const itemVal = stripComment(trimmed.slice(colonPos + 2).trim())
					const flowSeq = parseFlowSequence(itemVal, strict, baseLine + idx)
					const flowMap = flowSeq === null ? parseFlowMapping(itemVal, strict, baseLine + idx) : null
					pendingItem.set(itemKey, flowSeq !== null
						? { kind: 'array', items: flowSeq, line: baseLine + idx }
						: (flowMap !== null ? flowMap : parseScalarValue(itemVal, strict, baseLine + idx)))
					idx++
				} else if (trimmed.endsWith(':')) {
					const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
					const keyLineNum = baseLine + idx
					checkKeyLength(itemKey, keyLineNum)
					idx++
					let ni = idx
					while (ni < lines.length && !lines[ni].trim()) ni++
					if (ni < lines.length) {
						const nextIndent = lines[ni].length - lines[ni].trimStart().length
						if (nextIndent > indent) {
							const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, strict, baseLine)
							pendingItem.set(itemKey, nested ?? { kind: 'null', line: keyLineNum })
							idx = after
							continue
						}
					}
					pendingItem.set(itemKey, { kind: 'null', line: keyLineNum })
				} else {
					if (strict) throw new Error(`LIMA: unexpected syntax in array item continuation at line ${baseLine + idx}: "${trimmed}"`)
					idx++
				}
			} else {
				if (strict) throw new Error(`LIMA: unexpected indentation at line ${baseLine + idx}: "${trimmed}"`)
				idx++
			}
			continue
		}

		// ── indent === baseIndent ──────────────────────────────────────────
		const isList = trimmed.charCodeAt(0) === 45

		if (isList) {
			if (pendingItem !== null) {
				items!.push({ kind: 'mapping', entries: pendingItem, line: baseLine + idx })
				pendingItem = null
			}

			if (items === null) items = []
			if (entries !== null) {
				if (strict) throw new Error(`LIMA: mixed array and map entries for the same key at line ${baseLine + idx}`)
				idx++; continue
			}

			const afterDash = trimmed === '-' ? '' : stripComment(trimmed.replace(DASH_PREFIX_RE, ''))
			const flowMap   = parseFlowMapping(afterDash, strict, baseLine + idx)
			const colonPos  = findKeySep(afterDash)

			if (flowMap !== null) {
				items.push(flowMap)
				idx++
			} else if (afterDash === '-' || DASH_PREFIX_RE.test(afterDash)) {
				if (strict) throw new Error(`LIMA: nested block sequence at line ${baseLine + idx}: "${trimmed}"`)
				items.push({ kind: 'null', line: baseLine + idx })
				idx++
				while (idx < lines.length) {
					const nextTrimmed = lines[idx].trimStart()
					if (!nextTrimmed || nextTrimmed.charCodeAt(0) === 35) { idx++; continue }
					if (lines[idx].length - nextTrimmed.length <= baseIndent) break
					idx++
				}
			} else if (colonPos !== -1) {
				const pendingKey = stripKeyQuotes(afterDash.slice(0, colonPos).trim())
				checkKeyLength(pendingKey, baseLine + idx)
				const pendingRaw = afterDash.slice(colonPos + 2).trim()
				const pendingFlowSeq = parseFlowSequence(pendingRaw, strict, baseLine + idx)
				const pendingFlowMap = pendingFlowSeq === null ? parseFlowMapping(pendingRaw, strict, baseLine + idx) : null
				pendingItem = new Map()
				pendingItem.set(pendingKey, pendingFlowSeq !== null
					? { kind: 'array', items: pendingFlowSeq, line: baseLine + idx }
					: (pendingFlowMap !== null ? pendingFlowMap : parseScalarValue(pendingRaw, strict, baseLine + idx)))
				idx++
			} else if (afterDash.endsWith(':')) {
				const itemKey = stripKeyQuotes(afterDash.slice(0, -1).trim())
				const keyLineNum = baseLine + idx
				checkKeyLength(itemKey, keyLineNum)
				idx++
				let ni = idx
				while (ni < lines.length && !lines[ni].trim()) ni++
				if (ni < lines.length) {
					const nextIndent = lines[ni].length - lines[ni].trimStart().length
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, strict, baseLine)
						pendingItem = new Map()
						pendingItem.set(itemKey, nested ?? { kind: 'null', line: keyLineNum })
						idx = after
						continue
					}
				}
				pendingItem = new Map()
				pendingItem.set(itemKey, { kind: 'null', line: keyLineNum })
			} else {
				const qFirst = afterDash.charCodeAt(0)
				if ((qFirst === 34 || qFirst === 39) && afterDash.charCodeAt(afterDash.length - 1) === qFirst) {
					const inner = afterDash.slice(1, -1)
					const value = qFirst === 34 ? unescapeDQ(inner, strict, baseLine + idx) : inner.replace(/\\'/g, "'")
					checkScalarLimit(LString(value), baseLine + idx)
					items.push({ kind: 'string', value, line: baseLine + idx, quoted: true })
				} else {
					items.push(parseQuotedOrTyped(afterDash, strict, baseLine + idx, false))
				}
				idx++
			}
		} else {
			// ── Map entry ────────────────────────────────────────────────────
			if (items !== null) {
				if (strict) throw new Error(`LIMA: mixed map and array entries for the same key at line ${baseLine + idx}`)
				idx++; continue
			}

			const colonPos = findKeySep(trimmed)
			if (colonPos !== -1) {
				if (entries === null) entries = new Map()
				const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
				checkKeyLength(itemKey, baseLine + idx)
				checkDuplicateKeyMap(entries, itemKey, baseLine + idx, strict)
				const itemVal = stripComment(trimmed.slice(colonPos + 2).trim())
				const flowSeq = parseFlowSequence(itemVal, strict, baseLine + idx)
				const flowMap = flowSeq === null ? parseFlowMapping(itemVal, strict, baseLine + idx) : null
				entries.set(itemKey, flowSeq !== null
					? { kind: 'array', items: flowSeq, line: baseLine + idx }
					: (flowMap !== null ? flowMap : parseScalarValue(itemVal, strict, baseLine + idx)))
				idx++
			} else if (trimmed.endsWith(':')) {
				if (entries === null) entries = new Map()
				const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
				const keyLineNum = baseLine + idx
				checkKeyLength(itemKey, keyLineNum)
				checkDuplicateKeyMap(entries, itemKey, keyLineNum, strict)
				idx++
				let ni = idx
				while (ni < lines.length && !lines[ni].trim()) ni++
				if (ni < lines.length) {
					const nextIndent = lines[ni].length - lines[ni].trimStart().length
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, strict, baseLine)
						entries.set(itemKey, nested ?? { kind: 'null', line: keyLineNum })
						idx = after
						continue
					}
				}
				entries.set(itemKey, { kind: 'null', line: keyLineNum })
			} else {
				if (strict) throw new Error(`LIMA: indented freetext without a block scalar marker at line ${baseLine + idx}: "${trimmed}"`)
				idx++
			}
		}
	}

	if (pendingItem !== null) items!.push({ kind: 'mapping', entries: pendingItem, line: baseLine + startIdx })

	const value: PositionedValue | null =
		items !== null ? { kind: 'array', items, line: baseLine + startIdx } :
		entries !== null ? { kind: 'mapping', entries, line: baseLine + startIdx } :
		null

	return { value, nextIdx: idx }
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export type CoreOptions = { strict?: boolean }

/**
 * Parses LIMA Core 1.0 syntax into the internal annotated value tree —
 * every node carrying its source line, string leaves additionally carrying
 * whether they came from quoted syntax. `($key)`/`(%key)` text is left
 * exactly as written; nothing here ever inspects or resolves it.
 */
export const parseCoreWithPositions = (frontMatter: string, strict = false): Map<string, PositionedValue> => {
	if (byteLength(frontMatter) > DOCUMENT_SIZE_LIMIT) {
		throw new Error(`LIMA: document exceeds maximum size of ${DOCUMENT_SIZE_LIMIT} bytes at line 1`)
	}

	const root = new Map<string, PositionedValue>()
	if (!frontMatter) return root

	frontMatter = frontMatter
		.replace(/\r\n|\r/g, '\n')
		.replace(/^([ \t]*)/gm, (leading) => (leading.includes('\t') ? leading.replace(/\t/g, '  ') : leading))
		.replace(/ +(?=\n|$)/gm, '')

	let keyPositions: number[] | null = null
	const keyLine = (i: number): number => {
		if (keyPositions === null) {
			keyPositions = []
			const re = new RegExp(KEY_RE.source, 'gm')
			let m: RegExpExecArray | null
			while ((m = re.exec(frontMatter)) !== null) keyPositions.push(m.index)
		}
		return lineAt(frontMatter, keyPositions[i])
	}

	if (strict) {
		let searchFrom = 0
		while (searchFrom <= frontMatter.length) {
			const lineEnd = frontMatter.indexOf('\n', searchFrom)
			const line = lineEnd === -1 ? frontMatter.slice(searchFrom) : frontMatter.slice(searchFrom, lineEnd)
			if (SPACE_BEFORE_COLON_RE.test(line)) {
				throw new Error(`LIMA: space between closing quote and colon at line ${lineAt(frontMatter, searchFrom)}`)
			}
			if (lineEnd === -1) break
			searchFrom = lineEnd + 1
		}
	}

	const parts    = frontMatter.split(KEY_RE).slice(1)
	const keyCount = parts.length / 5 | 0

	if (keyCount === 0) return root

	if (keyCount > TOP_LEVEL_KEY_LIMIT) {
		throw new Error(`LIMA: too many top-level key entries (max ${TOP_LEVEL_KEY_LIMIT}) at line 1`)
	}

	for (let i = 0; i < keyCount; i++) {
		const rawDQ = parts[i * 5 + 2]
		const key   = parts[i * 5] ?? parts[i * 5 + 1] ?? (rawDQ !== undefined ? unescapeDQ(rawDQ) : undefined)
		if (key === undefined) continue
		checkKeyLength(key, keyLine(i))

		if (root.has(key)) {
			const msg = `LIMA: duplicate key "${key}" at line ${keyLine(i)} — last value wins`
			if (strict) throw new Error(msg)
			console.warn(msg)
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
			const parsed = parseBlock(lines, 0, baseIndent, strict, keyLine(i) + 1).value
			root.set(key, parsed ?? { kind: 'null', line: keyLine(i) })
		} else {
			if (lines.length === 0) {
				root.set(key, { kind: 'null', line: keyLine(i) })
				continue
			}

			const line0Trimmed = lines[0].trim()
			if (lines.length === 1 || (line0Trimmed !== '|' && line0Trimmed !== '>')) {
				const line0 = lines[0]
				const val   = line0.includes('#') ? stripComment(line0) : line0
				const flowSeq = parseFlowSequence(val, strict, keyLine(i))
				if (flowSeq !== null) {
					root.set(key, { kind: 'array', items: flowSeq, line: keyLine(i) })
				} else {
					const flowMap = parseFlowMapping(val, strict, keyLine(i))
					root.set(key, flowMap !== null ? flowMap : parseScalarValue(val, strict, keyLine(i)))
				}
				continue
			}

			// Multi-line string (`|` literal / `>` folded block scalar).
			const isPipeBlock   = lines[0].trim() === '|'
			const isFoldedBlock = !isPipeBlock && lines[0].trim() === '>'

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
				const isContinuation = isPipeBlock && dedented.startsWith('^^')
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

			const joined = isFoldedBlock ? mergedLines.join(' ') : mergedLines.join('\n')
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
		throw new Error(`LIMA: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1`)
	}

	return root
}

/** Converts a Lima value to a plain, native JS value (the public result shape). */
export const toNative = (v: LimaValue): any => {
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
			return out
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
	const root = parseCoreWithPositions(frontMatter, options?.strict ?? false)
	const out = emptyMapping()
	for (const [k, v] of root) out[k] = toNative(toPlainValue(v))
	return out as unknown as T
}
