/**
 * Core scalar grammar: the annotated `PositionedValue` tree type, dates,
 * numbers/type coercion, quoting/escaping, and the shared quoted-or-typed
 * scalar parser every value position (inline values, flow items, block
 * array/map items) builds on.
 */

import { type LimaValue, LNull, LBool, LFloat, LInt, LString, LInstant } from './value.js'
import { type ParseContext, checkStringLimit } from './normalize.js'
import { LimaError } from './errors.js'
import type { ValueBuilder } from './builder.js'

/**
 * `insertedAt` is never set by Core — it's a References-only annotation
 * (see references.ts's `resolveTree`), stamped on the root of a value
 * copied in by a successful pure-reference resolution, with the source
 * token and line that caused the insertion. It powers References §5's
 * global-error attribution (R-112): when a final-result limit (nesting
 * depth, total node count) is violated, the lowest-line `insertedAt` among
 * the participating nodes identifies which reference token to blame — the
 * spec requires the error message to include both the token and the line.
 */
export type InsertedAt = { line: number; token: string }

export type PositionedValue =
	| { kind: 'null'; line: number; insertedAt?: InsertedAt }
	| { kind: 'bool'; value: boolean; line: number; insertedAt?: InsertedAt }
	| { kind: 'int'; value: number; line: number; insertedAt?: InsertedAt }
	| { kind: 'float'; value: number; line: number; insertedAt?: InsertedAt }
	| { kind: 'string'; value: string; line: number; quoted: boolean; insertedAt?: InsertedAt }
	| { kind: 'instant'; value: Date; line: number; insertedAt?: InsertedAt }
	| { kind: 'array'; items: PositionedValue[]; line: number; insertedAt?: InsertedAt }
	| { kind: 'mapping'; entries: Map<string, PositionedValue>; line: number; insertedAt?: InsertedAt }

/** The `ValueBuilder<PositionedValue>` — reconstructs today's annotated tree exactly, for References. */
export const positionedBuilder: ValueBuilder<PositionedValue> = {
	null: (line) => ({ kind: 'null', line }),
	bool: (value, line) => ({ kind: 'bool', value, line }),
	int: (value, line) => ({ kind: 'int', value, line }),
	float: (value, line) => ({ kind: 'float', value, line }),
	string: (value, line, quoted) => ({ kind: 'string', value, line, quoted }),
	instant: (value, line) => ({ kind: 'instant', value, line }),
	array: (items, line) => ({ kind: 'array', items, line }),
	createMapping: () => new Map<string, PositionedValue>(),
	createMappingWith: (key, value) => new Map([[key, value]]),
	hasMappingKey: (entries, key) => entries.has(key),
	setMapping: (entries, key, value) => { entries.set(key, value) },
	mappingMaxDepth: (entries, depthOf) => {
		let max = 0
		for (const value of entries.values()) {
			if (value.kind === 'array' || value.kind === 'mapping') max = Math.max(max, depthOf(value))
		}
		return max
	},
	mapping: (entries, line) => ({ kind: 'mapping', entries, line }),
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

// ─── Dates ──────────────────────────────────────────────────────────────────

const ISO_DATE_RE    = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/
const GERMAN_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/
const SLASH_DATE_RE  = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInMonth = (y: number, m: number): number => (m === 2 && isLeapYear(y)) ? 29 : DAYS_IN_MONTH[m - 1]

/** Shared exact ISO-date recognizer over either a complete string or a source span. */
const parseExactIsoSpan = (source: string, start: number, end: number, strict: boolean, line: number): Date | null => {
	const length = end - start
	const dateOnly = length === 10 && source.charCodeAt(start + 4) === 45 && source.charCodeAt(start + 7) === 45
	const instant = length === 20 && source.charCodeAt(start + 4) === 45 && source.charCodeAt(start + 7) === 45 &&
		source.charCodeAt(start + 10) === 84 && source.charCodeAt(start + 13) === 58 &&
		source.charCodeAt(start + 16) === 58 && source.charCodeAt(start + 19) === 90
	if (!dateOnly && !instant) return null
	const digitAt = (offset: number): number => source.charCodeAt(start + offset) - 48
	const d0 = digitAt(0), d1 = digitAt(1), d2 = digitAt(2), d3 = digitAt(3)
	const d5 = digitAt(5), d6 = digitAt(6), d8 = digitAt(8), d9 = digitAt(9)
	if (d0 < 0 || d0 > 9 || d1 < 0 || d1 > 9 || d2 < 0 || d2 > 9 || d3 < 0 || d3 > 9 ||
		d5 < 0 || d5 > 9 || d6 < 0 || d6 > 9 || d8 < 0 || d8 > 9 || d9 < 0 || d9 > 9) return null
	const year = d0 * 1000 + d1 * 100 + d2 * 10 + d3
	const month = d5 * 10 + d6, day = d8 * 10 + d9
	let hour = 0, minute = 0, second = 0
	if (instant) {
		const d11 = digitAt(11), d12 = digitAt(12), d14 = digitAt(14), d15 = digitAt(15)
		const d17 = digitAt(17), d18 = digitAt(18)
		if (d11 < 0 || d11 > 9 || d12 < 0 || d12 > 9 || d14 < 0 || d14 > 9 ||
			d15 < 0 || d15 > 9 || d17 < 0 || d17 > 9 || d18 < 0 || d18 > 9) return null
		hour = d11 * 10 + d12; minute = d14 * 10 + d15; second = d17 * 10 + d18
	}
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
		hour > 23 || minute > 59 || second > 59) {
		if (strict) {
			const raw = source.slice(start, end)
			throw new LimaError({ code: 'INVALID_DATE', line, message: `Lima: invalid date "${raw}" at line ${line}` })
		}
		return null
	}
	if (year >= 100) return new Date(Date.UTC(year, month - 1, day, hour, minute, second))
	const result = new Date(0)
	result.setUTCFullYear(year, month - 1, day)
	if (instant) result.setUTCHours(hour, minute, second, 0)
	return result
}

const parseDateUTC = (str: string, strict = false, line = 0): Date | null => {
	const invalid = (): null => {
		if (strict) throw new LimaError({ code: 'INVALID_DATE', line, message: `Lima: invalid date "${str}" at line ${line}` })
		return null
	}

	const exact = parseExactIsoSpan(str, 0, str.length, strict, line)
	if (exact !== null) return exact

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
const DATE_PRE_RE = /\d[\d\-:.\/a-zA-Z]{4,}/
const isFloatForm = (str: string): boolean => str.includes('.') || str.includes('e') || str.includes('E')
const isZeroLiteral = (str: string): boolean => /^0+(\.0+)?$/.test(str.replace(/^-/, '').split(/[eE]/)[0])

export const NO_SPAN_VALUE: unique symbol = Symbol('NO_SPAN_VALUE')

/**
 * Parses allocation-free scalar forms whose complete grammar can be proven
 * directly from one source span. Everything else returns a sentinel and is
 * handled by the full string-based scalar/flow grammar.
 */
export const parseSimpleScalarSpan = <V, M>(
	source: string, start: number, end: number, line: number, strict: boolean, builder: ValueBuilder<V, M>,
): V | typeof NO_SPAN_VALUE => {
	const length = end - start
	if (length === 10 || length === 20) {
		const exact = parseExactIsoSpan(source, start, end, strict, line)
		if (exact !== null) return builder.instant(exact, line)
	}
	if (length === 1 && source.charCodeAt(start) === 126) return builder.null(line)
	if (length === 4) {
		const a = source.charCodeAt(start), b = source.charCodeAt(start + 1)
		const c = source.charCodeAt(start + 2), d = source.charCodeAt(start + 3)
		if (a === 116 && b === 114 && c === 117 && d === 101) return builder.bool(true, line)
		if (a === 110 && b === 117 && c === 108 && d === 108) return builder.null(line)
	}
	if (length === 5 && source.charCodeAt(start) === 102 && source.charCodeAt(start + 1) === 97 &&
		source.charCodeAt(start + 2) === 108 && source.charCodeAt(start + 3) === 115 &&
		source.charCodeAt(start + 4) === 101) return builder.bool(false, line)
	if (length === 0 || length > 15) return NO_SPAN_VALUE
	const first = source.charCodeAt(start)
	if (first === 48 && length !== 1) return NO_SPAN_VALUE
	let value = 0
	for (let pos = start; pos < end; pos++) {
		const digit = source.charCodeAt(pos) - 48
		if (digit < 0 || digit > 9) return NO_SPAN_VALUE
		value = value * 10 + digit
	}
	return value <= Number.MAX_SAFE_INTEGER ? builder.int(value, line) : NO_SPAN_VALUE
}

/**
 * Classifies a raw token and constructs its final builder value directly,
 * per Core §6.4.1's explicit number
 * grammar (never `Number()`/`parseFloat()`, which accept far more than Lima
 * does) and the three §6.5.1 date shapes. Reference-shaped text (`($key)`,
 * `(%key)`) matches none of these and falls through to a plain string,
 * unrecognised and unresolved — Core has no concept of it at all. Avoiding
 * an intermediate tagged `LimaValue` keeps both builders on one grammar while
 * eliminating an allocate-then-switch conversion for every scalar.
 */
const buildTyped = <V, M>(
	str: string, strict: boolean, line: number, builder: ValueBuilder<V, M>,
): V => {
	if (str === '' || str === 'null' || str === '~') return builder.null(line)
	if (str === 'true') return builder.bool(true, line)
	if (str === 'false') return builder.bool(false, line)
	const first = str.charCodeAt(0)
	// Every number and every supported date form starts with a digit, '-'
	// or '.'. Once the null/boolean literals above are excluded, any other
	// leading character is unconditionally a string; avoid both regexes and
	// the email/date prechecks for ordinary words, URLs and identifiers.
	if (!((first >= 48 && first <= 57) || first === 45 || first === 46)) {
		checkStringLimit(str, line)
		return builder.string(str, line, false)
	}
	// Hex (0x/0X), octal (0o/0O), binary (0b/0B) — kept as strings (YAML 1.2 compatible).
	if (str.length > 2 && str.charCodeAt(0) === 48 &&
		(str.charCodeAt(1) === 120 || str.charCodeAt(1) === 88 ||
		 str.charCodeAt(1) === 111 || str.charCodeAt(1) === 79 ||
		 str.charCodeAt(1) === 98  || str.charCodeAt(1) === 66)) {
		checkStringLimit(str, line)
		return builder.string(str, line, false)
	}
	const exactIsoShape =
		(str.length === 10 && str.charCodeAt(4) === 45 && str.charCodeAt(7) === 45) ||
		(str.length === 20 && str.charCodeAt(4) === 45 && str.charCodeAt(7) === 45 &&
			str.charCodeAt(10) === 84 && str.charCodeAt(13) === 58 &&
			str.charCodeAt(16) === 58 && str.charCodeAt(19) === 90)
	if (exactIsoShape) {
		const date = parseDateUTC(str, strict, line)
		if (date !== null) return builder.instant(date, line)
		checkStringLimit(str, line)
		return builder.string(str, line, false)
	}
	if (NUMBER_RE.test(str)) {
		const n = Number(str)
		if (isFloatForm(str)) {
			if (!Number.isFinite(n)) {
				if (strict) throw new LimaError({
					code: 'INVALID_NUMBER', line,
					message: `Lima: float value overflows to a non-finite value at line ${line}: "${str}"`,
				})
			} else if (n === 0 && !isZeroLiteral(str)) {
				if (strict) throw new LimaError({
					code: 'INVALID_NUMBER', line,
					message: `Lima: non-zero float value underflows to zero at line ${line}: "${str}"`,
				})
			} else {
				return builder.float(n === 0 ? 0 : n, line)
			}
		} else if (Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
			return builder.int(n === 0 ? 0 : n, line)
		}
		// Outside the safe integer range, or overflow/underflow already
		// handled above in non-strict mode: fall through to string.
	}
	if (!str.includes('@') && DATE_PRE_RE.test(str)) {
		const date = parseDateUTC(str, strict, line)
		if (date !== null) return builder.instant(date, line)
	}
	checkStringLimit(str, line)
	return builder.string(str, line, false)
}

// ─── Scalar / quoting ──────────────────────────────────────────────────────

const ESCAPED_HASH_RE = /\\#/g
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

export const unescapeDQ = (s: string, strict = false, line = 0): string => {
	if (!s.includes('\\')) return s
	if (strict) {
		for (const m of s.matchAll(ANY_ESCAPE_RE)) {
			if (!isValidEscape(m[0].slice(1))) {
				throw new LimaError({ code: 'INVALID_ESCAPE', line, message: `Lima: unknown escape sequence "${m[0]}" at line ${line}` })
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

export const stripComment = (val: string): string => {
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

/** Strips a key's surrounding quotes (unescaping double-quoted keys), or returns it unchanged. */
export const stripKeyQuotes = (s: string): string => {
	const f = s.charCodeAt(0)
	if (f === 39 && s.charCodeAt(s.length - 1) === 39) return s.slice(1, -1)
	if (f === 34 && s.charCodeAt(s.length - 1) === 34) return unescapeDQ(s.slice(1, -1))
	return s
}

/**
 * Quoted-or-typed scalar, shared by every value position (top-level inline
 * values, flow-sequence/flow-mapping items, block-array scalar items).
 * `topLevel` gates two checks that only apply at the outermost resolveValue
 * call site in the legacy parser and are deliberately not extended to flow
 * items here, to keep this a faithful behavioral port: the "unclosed flow
 * bracket" throw and the "non-whitespace after closing quote" strict throw.
 */
export const parseQuotedOrTyped = <V, M>(
	raw: string, ctx: ParseContext, line: number, topLevel: boolean, builder: ValueBuilder<V, M>,
): V => {
	const first = raw.charCodeAt(0)
	if (first === 34 || first === 39) {
		if (raw.charCodeAt(raw.length - 1) === first) {
			const unquoted = raw.slice(1, -1)
			const value = first === 34 ? unescapeDQ(unquoted, ctx.strict, line) : unquoted.replace(/\\'/g, "'")
			checkStringLimit(value, line)
			return builder.string(value, line, true)
		}
		if (topLevel && ctx.strict) {
			throw new LimaError({ code: 'INVALID_QUOTE', line, message: `Lima: non-whitespace content after closing quote at line ${line}` })
		}
	}
	if (raw !== '' && raw !== 'null' && raw !== '~' && raw !== 'true' && raw !== 'false' &&
		!((first >= 48 && first <= 57) || first === 45 || first === 46)) {
		checkStringLimit(raw, line)
		return builder.string(raw, line, false)
	}
	return buildTyped(raw, ctx.strict, line, builder)
}

export const parseScalarValue = <V, M>(raw: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>): V => {
	const first = raw.charCodeAt(0)
	if (ctx.strict && (first === 91 || first === 123)) {
		throw new LimaError({
			code: 'INVALID_FLOW_SYNTAX', line,
			message: `Lima: unclosed flow ${first === 91 ? 'sequence' : 'mapping'} at line ${line}`,
		})
	}
	return parseQuotedOrTyped(raw, ctx, line, true, builder)
}
