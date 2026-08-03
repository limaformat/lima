/**
 * LIMA Parser — LIMA Is Metadata Annotation
 *
 * Parses LIMA frontmatter syntax into a plain JavaScript object.
 * LIMA is a deliberate, focused subset of YAML with two additions:
 *   - ($key)        references a property in the same document
 *   - ($a.b.c)      dotted path — traverses nested objects
 *   - (%key)        references an externally provided partial
 *
 * References can be used as pure references (entire value) or embedded in
 * strings via interpolation:
 *   - Pure:         `author: ($defaultAuthor)`    → preserves original type
 *   - Interpolated: `title: Hello ($firstName)!`  → always produces a string
 */

type Meta = Record<string, any>

/**
 * Every Lima mapping result must be a prototype-free object (Core spec
 * §11.1) — `Object.create(null)`, not `{}`. Consumers must not encounter
 * inherited `Object.prototype` members on a parsed mapping.
 */
const emptyMapping = (): Meta => Object.create(null)

/**
 * References §5 (Error Ordering): "All reference-resolution errors
 * associated with source tokens are collected and ordered by source
 * position ... The error at the lowest source position is thrown." This
 * applies across error types (unresolved references, mapping-in-
 * interpolation, invalid array elements) — a mapping-interpolation error
 * on line 4 must not preempt an unresolved reference on line 1 just
 * because the parser's traversal happens to reach line 4's value first.
 *
 * Sites that would otherwise throw immediately for one of these error
 * types push a descriptor here instead and return a harmless fallback so
 * traversal can continue collecting any other errors; `parse()` sorts by
 * line (this parser tracks line-level position only — column-level
 * ordering, §5's tie-breaker, is not currently retained past the key
 * level) and throws the earliest once resolution is complete.
 *
 * Module-level rather than threaded through every resolution function's
 * parameters: `parse()` is synchronous and never reentrant within a
 * single call, so a reset at the top of every call is sufficient and far
 * less invasive than adding a parameter to a dozen call sites.
 */
let collectedRefErrors: { line: number; message: string }[] = []

/**
 * References §2.3: a reference token inside a quoted string is inactive —
 * literal text, never resolved. Once a quoted value's delimiters are
 * stripped, its text can look identical to an active token, and later
 * phases (forward-reference resolution, the strict unresolved-reference
 * scan) must not rediscover it by re-scanning the final string ("[t]he
 * resolution phases must not rediscover reference-like substrings by
 * scanning final Core string values"). A quoted value is therefore wrapped
 * in this internal marker at parse time — recognised and skipped by every
 * later phase — and unwrapped back to a plain string in one final pass
 * (`unwrapInactive`) before the result is returned. A `Symbol` key (rather
 * than a string key like `"$inactive"`) avoids any chance of colliding
 * with a real Lima mapping that happens to contain a same-shaped value.
 */
const INACTIVE_TOKEN = Symbol('limaInactive')
interface InactiveValue {
	[INACTIVE_TOKEN]: true
	value: string
}
const markInactive = (value: string): InactiveValue => ({ [INACTIVE_TOKEN]: true, value })
const isInactiveValue = (v: any): v is InactiveValue =>
	v !== null && typeof v === 'object' && v[INACTIVE_TOKEN] === true

/** Replaces every inactive-value marker in a tree with its plain string,
 *  recursively. Must run once, at the very end of `parse`, before the
 *  result is returned — no marker may ever reach the public API. */
const unwrapInactive = (value: any): any => {
	if (isInactiveValue(value)) return value.value
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) value[i] = unwrapInactive(value[i])
		return value
	}
	if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
		for (const key of Object.keys(value)) value[key] = unwrapInactive(value[key])
		return value
	}
	return value
}

/**
 * Structural deep copy into a Lima-owned, prototype-free value. Pure
 * references must not alias their target — References §3.1: "The result
 * is a structural deep copy — object identity and aliasing are not part
 * of Lima semantics." Applies equally to `($key)` document references and
 * `(%key)` partial references (References §6.2: partials are deep-copied
 * into Lima-owned values, the original host objects are never used
 * directly in a result).
 */
const deepCopyLimaValue = (value: any): any => {
	if (isInactiveValue(value)) return markInactive(value.value)
	if (value === null || typeof value !== 'object') return value
	if (value instanceof Date) return new Date(value.getTime())
	if (Array.isArray(value)) return value.map(deepCopyLimaValue)
	const copy = emptyMapping()
	for (const key of Object.keys(value)) copy[key] = deepCopyLimaValue(value[key])
	return copy
}

/** References §6.2: partial mapping keys share Core's 128-code-point key limit. */
const PARTIAL_KEY_LENGTH_LIMIT = 128
/** References §6.2: "max 16 nesting levels combined with mappings", per partial value. */
const PARTIAL_VALUE_DEPTH_LIMIT = 16
/** References §6.2 partial resource limits. */
const PARTIAL_COUNT_LIMIT = 128
const PARTIAL_NAME_LENGTH_LIMIT = 128
const PARTIAL_NODE_LIMIT = 4096
/** References §6.2 final-result resource limit, checked after resolution completes. */
const RESULT_NODE_LIMIT = 65536

/**
 * Validates a single host value against the Lima Value Model (References
 * §6.2) before document parsing begins — recursively, at every depth of a
 * partial's own value tree. `seen` tracks the current recursion path (not
 * every visited object) to detect genuine cycles without rejecting shared,
 * non-cyclic substructure. `depth` follows the same `depth(scalar) = 0` /
 * `depth(collection) = 1 + depth(child)` convention as Core §9's document
 * nesting-depth check.
 *
 * Host types with no Lima equivalent (functions, symbols, class instances,
 * accessor properties) are rejected outright rather than silently coerced —
 * "class instance with own data properties" is not the same value model as
 * "plain mapping", even though `Object.keys()` cannot tell them apart
 * without an explicit prototype check.
 */
const validatePartialValue = (
	value: any, partialName: string, path: string, depth = 0, seen: Set<any> = new Set()
): void => {
	if (value === null || typeof value === 'boolean') return
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": non-finite number`)
		}
		return
	}
	if (typeof value === 'string') {
		if ([...value].length > SCALAR_LENGTH_LIMIT) {
			throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": string exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points`)
		}
		return
	}
	if (value instanceof Date) {
		if (isNaN(value.getTime())) {
			throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": invalid date`)
		}
		const year = value.getUTCFullYear()
		if (year < 1 || year > 9999) {
			throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": date year ${year} outside the range 0001-9999`)
		}
		return
	}
	if (value === undefined || typeof value !== 'object') {
		// undefined, function, symbol, bigint, ... — no Lima equivalent.
		throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": unsupported value type`)
	}
	if (seen.has(value)) {
		throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": cyclic reference`)
	}
	if (depth >= PARTIAL_VALUE_DEPTH_LIMIT) {
		throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": nesting depth exceeds maximum of ${PARTIAL_VALUE_DEPTH_LIMIT}`)
	}
	seen.add(value)
	if (Array.isArray(value)) {
		value.forEach((item, i) => {
			if (Array.isArray(item)) {
				throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}[${i}]": nested arrays are not supported`)
			}
			validatePartialValue(item, partialName, `${path}[${i}]`, depth + 1, seen)
		})
	} else {
		// Plain-object check: `Object.keys()` alone can't distinguish a class
		// instance's own data properties from a genuine plain mapping — a
		// prototype check can. `Object.create(null)` (proto === null) is also
		// accepted, matching this parser's own prototype-free convention.
		const proto = Object.getPrototypeOf(value)
		if (proto !== null && proto !== Object.prototype) {
			throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}": unsupported value type`)
		}
		for (const key of Object.keys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key)
			if (!descriptor || !('value' in descriptor)) {
				throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}.${key}": accessor properties are not supported`)
			}
			if ([...key].length > PARTIAL_KEY_LENGTH_LIMIT) {
				throw new Error(`LIMA: invalid partial "${partialName}" at path "${path}.${key}": key exceeds maximum length of ${PARTIAL_KEY_LENGTH_LIMIT} code points`)
			}
			validatePartialValue(value[key], partialName, `${path}.${key}`, depth + 1, seen)
		}
	}
	seen.delete(value)
}

/**
 * References §6.2 node-count definition, used both for the pre-parsing
 * partial-node-budget check (4,096 across all partials combined) and the
 * post-resolution final-result check (65,536). `nodeCount(scalar) = 1`,
 * `nodeCount(collection) = 1 + sum(nodeCount(child))` — mapping keys do not
 * count as separate nodes.
 */
const countValueNodes = (value: any): number => {
	if (isInactiveValue(value)) return 1
	if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + countValueNodes(item), 0)
	if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
		return 1 + Object.values(value).reduce((sum: number, v) => sum + countValueNodes(v), 0)
	}
	return 1
}

/**
 * References §3.8 ("No Traversal into Partial Values"): reference-like
 * strings inside a partial are always literal, never active tokens — the
 * resolution phases must not rediscover them by scanning the string
 * content. Every string leaf in a partial's value tree is therefore
 * wrapped as inactive up front, the same internal marker quoted document
 * strings use (see `markInactive`), so `isReferenceFree()` and
 * `resolveForward()` treat it as opaque without needing to inspect its
 * text. Containers (arrays/mappings) are rebuilt, not wrapped themselves —
 * only their string leaves are.
 *
 * Also normalises negative zero to positive zero (References §6.2: "Negative
 * zero is normalised to positive zero") and rebuilds every plain object as a
 * prototype-free mapping (Core §11.1), so a validated partial's containers
 * match every other Lima mapping's binding shape.
 */
const sanitizePartialValue = (value: any): any => {
	if (typeof value === 'string') return markInactive(value)
	if (typeof value === 'number') return value === 0 ? 0 : value
	// References §6.2: "milliseconds are truncated (not rounded) to zero" —
	// a copy, never the host's own Date instance (kept Lima-owned, matching
	// pure-reference deep-copy semantics elsewhere).
	if (value instanceof Date) return new Date(Math.floor(value.getTime() / 1000) * 1000)
	if (Array.isArray(value)) return value.map(sanitizePartialValue)
	if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
		const out: Meta = emptyMapping()
		for (const key of Object.keys(value)) out[key] = sanitizePartialValue(value[key])
		return out
	}
	return value
}

/**
 * Non-mutating counterpart to `unwrapInactive`, for consumption points
 * (canonical-string interpolation, array-interpolation joining) that must
 * read a partial's plain content without permanently stripping the
 * inactive marker from the shared, sanitized `partials` map — the same
 * partial may be referenced again elsewhere and must stay protected.
 */
const unwrapInactiveReadonly = (value: any): any => {
	if (isInactiveValue(value)) return value.value
	if (Array.isArray(value)) return value.map(unwrapInactiveReadonly)
	if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
		const out: Meta = emptyMapping()
		for (const key of Object.keys(value)) out[key] = unwrapInactiveReadonly(value[key])
		return out
	}
	return value
}

type ParseOptions = {
	/** Named values available via `(%key)` references. */
	partials?: Meta
	/**
	 * When `true`, the parser throws on unresolvable references, invalid flow
	 * mappings, and unrecognised syntax instead of silently skipping or falling
	 * back. Useful for CI environments where silent data loss is unacceptable.
	 *
	 * Forward references are resolved in a second pass — they work in both strict
	 * and non-strict mode. An error is thrown only when a reference cannot be
	 * resolved after all keys are parsed.
	 */
	strict?: boolean
}

// ─── Precompiled regexes ──────────────────────────────────────────────────────

/**
 * Identifies a LIMA key at the start of a line.
 *
 * Key name rules:
 *   - Starts with a letter (upper or lower) or underscore
 *   - Continues with letters, digits, underscores, hyphens, or colons
 *
 * Valid examples: `title`, `firstName`, `h1`, `_draft`, `snake_case`, `kebab-case`, `og:title`
 * Invalid:        `1st` (digit start)
 *
 * Uses plain ASCII character classes instead of Unicode property escapes
 * (\p{Lu}/\p{Ll}) — frontmatter keys are always ASCII, and property escapes
 * require large Unicode table lookups on every match.
 *
 * The separator group is simplified because parse() normalizes the input
 * (CRLF → LF, tabs → spaces) before splitting, so \r and \t can't appear here.
 *
 * The regex has 2 capture groups:
 *   g1 → key name
 *   g2 → separator: spaces+newline (block value) or single space (inline value)
 *
 * After split+slice(1), parts repeat every 3 elements:
 *   i*3+0 → key name
 *   i*3+1 → separator
 *   i*3+2 → raw value string
 */
// Double-quoted key group allows escaped characters (including `\"`) inside
// the key — Core §5.2: "Double-quoted keys decode the same backslash escape
// sequences as double-quoted string values." A naive `[^"]*` stops at the
// first *escaped* quote too, silently failing to recognise the key at all.
const KEY_RE = /^(?:([a-zA-Z\d_][a-zA-Z\d_:-]*)|'([^']*)'|"((?:[^"\\]|\\.)*)"):( *\n| )/gm

/**
 * Matches a would-be quoted key followed by whitespace before the colon —
 * Core §5.2: valid only when the separator follows the closing quote
 * immediately; a space in between throws in strict mode. A line matching
 * this can never also match KEY_RE (which requires zero space here), so
 * there is no risk of double-counting a line as both a valid key and this.
 */
const SPACE_BEFORE_COLON_RE = /^(?:'[^']*'|"(?:[^"\\]|\\.)*")[ \t]+:/
/** Used to unescape `\#` → `#` after stripping comments. */
const ESCAPED_HASH_RE = /\\#/g
// References §2.1/§2.2/Appendix B: the normative reference grammar, per sigil.
// A document path is dot-separated key-segments; a partial key is flat (no
// dots — dotted partial syntax is explicitly not supported) but may contain
// literal forward slashes for namespacing.
//   key-segment = [a-zA-Z0-9_][a-zA-Z0-9_:\-]*
//   doc-path    = key-segment ("." key-segment)*
//   partial-key = [a-zA-Z0-9_][a-zA-Z0-9_:\-\/]*
const DOC_SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*'
const DOC_PATH = `${DOC_SEGMENT}(?:\\.${DOC_SEGMENT})*`
const PARTIAL_KEY = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*'
/**
 * Pure reference: entire value is exactly one ($path) or (%key), matched
 * against the precise grammar above — not "any character but )". Capture
 * groups: [1] = document path (only when the $ form matched), [2] = partial
 * key (only when the % form matched); exactly one is ever defined.
 */
const PURE_REF_RE = new RegExp(`^\\((?:\\$(${DOC_PATH})|%(${PARTIAL_KEY}))\\)$`)
/** Inline reference occurrences for string interpolation — same grammar, unanchored/global. */
const INTERP_RE = new RegExp(`\\((?:\\$(${DOC_PATH})|%(${PARTIAL_KEY}))\\)`, 'g')
/** Detects strings that might be a date (quick pre-check before Date.parse). */
const DATE_PRE_RE = /\d[\d\-:.\/a-zA-Z]{4,}/
/** Strips the leading `- ` from a block array item. */
const DASH_PREFIX_RE = /^-\s+/
/** Matches any backslash escape sequence, valid or not — used to find unknown
 *  escapes in strict mode (Core §6.1.2, §10.1). */
const ANY_ESCAPE_RE = /\\(u[0-9a-fA-F]{0,4}|U[0-9a-fA-F]{0,8}|x[0-9a-fA-F]{0,2}|.)/gs
const SINGLE_CHAR_ESCAPES = '"\\/bfnrt' // deliberately excludes '0' — Core Appendix A treats a backslash-zero escape as unknown, not a null-character shorthand.
const U_ESCAPE_RE = /^u([0-9a-fA-F]{4})$/
const CAP_U_ESCAPE_RE = /^U([0-9a-fA-F]{8})$/
const X_ESCAPE_RE = /^x([0-9a-fA-F]{2})$/

/**
 * Validates one escape's content (the text after the backslash, e.g. `n`,
 * `u00e9`, `U0001F600`) against Core §6.1.2 — structurally *and*
 * semantically: a `\uXXXX` in the UTF-16 surrogate range (U+D800–U+DFFF)
 * or a `\UXXXXXXXX` beyond U+10FFFF matches the 4-or-8-hex-digit shape but
 * is still invalid, and must not reach `String.fromCodePoint` (which
 * throws a raw RangeError for out-of-range values, not a LIMA error).
 */
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

// Core §9 resource limits. All are hard errors in both modes — never gated
// on `strict`; limits are security boundaries, not style preferences.
const SCALAR_LENGTH_LIMIT = 16384
const DOCUMENT_SIZE_LIMIT = 65536
const KEY_LENGTH_LIMIT = 128
const TOP_LEVEL_KEY_LIMIT = 128
const NESTING_DEPTH_LIMIT = 16

const utf8Encoder = new TextEncoder()
/** UTF-8 byte length, per Core §9's document-size measurement convention. */
const byteLength = (s: string): number => utf8Encoder.encode(s).length

/**
 * Throws if a resolved scalar string exceeds the Core §9 length limit.
 * Counts Unicode code points (not UTF-16 units) via spread iteration, so a
 * surrogate pair counts as one code point.
 */
const checkScalarLimit = (value: unknown, line: number): void => {
	if (typeof value === 'string' && [...value].length > SCALAR_LENGTH_LIMIT) {
		throw new Error(`LIMA: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${line}`)
	}
}

/** Throws if a key exceeds the Core §9 key-length limit (Unicode code points). */
const checkKeyLength = (key: string, line: number): void => {
	if ([...key].length > KEY_LENGTH_LIMIT) {
		throw new Error(`LIMA: key "${key}" exceeds maximum length of ${KEY_LENGTH_LIMIT} code points at line ${line}`)
	}
}

/**
 * Core §5.3: duplicate keys are invalid at every mapping level — top-level,
 * nested block mappings, and flow mappings alike. Non-strict: warn and let
 * the later assignment overwrite (last value wins). Strict: throw with the
 * key name and line.
 */
const checkDuplicateKey = (mapping: Meta, key: string, line: number, strict: boolean): void => {
	if (!(key in mapping)) return
	const msg = `LIMA: duplicate key "${key}" at line ${line} — last value wins`
	if (strict) throw new Error(msg)
	console.warn(msg)
}

/**
 * Core §9 nesting-depth formula: `depth(scalar) = 0`, `depth(collection) =
 * 1 + max(depth(child))` (or 1 if empty). The document root mapping itself
 * does not count as a level.
 */
const computeDepth = (value: any): number => {
	if (isInactiveValue(value)) return 0
	if (Array.isArray(value)) {
		return value.length === 0 ? 1 : 1 + Math.max(...value.map(computeDepth))
	}
	if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
		const values = Object.values(value)
		return values.length === 0 ? 1 : 1 + Math.max(...values.map(computeDepth))
	}
	return 0
}

/** Counts leading ASCII space characters without allocating a new string. */
const leadingSpaces = (line: string): number => {
	let i = 0
	while (i < line.length && line.charCodeAt(i) === 32) i++
	return i
}

/** Returns the 1-based line number at byte offset `pos` in `s`. Only called on error paths. */
const lineAt = (s: string, pos: number): number => {
	let n = 1
	for (let i = 0; i < pos; i++) if (s.charCodeAt(i) === 10) n++
	return n
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

// Core §6.5.1: the three recognised date shapes, matched exactly against
// the whole value. Month/day are exactly two digits for ISO and slash
// forms; the German form allows one or two digits. Offset is ISO-only.
const ISO_DATE_RE    = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/
const GERMAN_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/
const SLASH_DATE_RE  = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInMonth = (y: number, m: number): number => (m === 2 && isLeapYear(y)) ? 29 : DAYS_IN_MONTH[m - 1]

/**
 * Parses one of the Core §6.5.1 date forms into a UTC Instant, with full
 * component validation (§6.5.2) and the UTC-instant range check (§6.5.3).
 *
 * Component ranges (year, month, day-of-month via the real calendar, hour,
 * minute, second, offset) are validated directly against the regex-captured
 * digits — never delegated to `Date.parse`/the `Date` constructor, which
 * silently roll invalid calendar dates over into the next valid one (e.g.
 * `2024-02-30` → March 1) instead of rejecting them.
 *
 * Returns `null` when the value is not one of the three recognised date
 * shapes at all — the ordinary "not a date" case, never an error. Also
 * returns `null` (non-strict) or throws (strict) when the value *is*
 * date-shaped but has an invalid component or produces a UTC Instant
 * outside years 0001–9999 — Core §10.1 lists this as its own strict-error
 * row, distinct from "not a date at all".
 */
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
			const sign = offsetStr.charCodeAt(0) === 45 /* '-' */ ? -1 : 1
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
		return null // not one of the three recognised date shapes at all
	}

	if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) ||
		h > 23 || mi > 59 || s > 59) return invalid()

	// setUTCFullYear (unlike the Date constructor / Date.UTC) never maps a
	// 0-99 year into 1900-1999 — required since valid Lima years start at 0001.
	const base = new Date(0)
	base.setUTCFullYear(y, mo - 1, d)
	base.setUTCHours(h, mi, s, 0)
	const result = new Date(base.getTime() - offsetMin * 60000)

	// §6.5.3: the UTC Instant after applying the offset must also fall
	// within years 0001-9999.
	const utcYear = result.getUTCFullYear()
	if (utcYear < 1 || utcYear > 9999) return invalid()

	return result
}

// Core §6.4.1 number grammar, applied directly rather than delegated to
// Number()/parseFloat(): those accept far more than Lima does — leading
// zeros ("01"), a bare trailing decimal point ("1."), surrounding
// whitespace, and more.
//   number       = "-"? significand exponent?
//   significand  = integer-part | decimal | leading
//   integer-part = "0" | [1-9][0-9]*
//   decimal      = integer-part "." [0-9]+
//   leading      = "." [0-9]+
//   exponent     = [eE] [+-]? [0-9]+
const NUMBER_RE = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/

// Core §6.4.1: a number with a decimal point or an exponent (or both) is a float.
const isFloatForm = (str: string): boolean => str.includes('.') || str.includes('e') || str.includes('E')

// Whether the significand (sign and exponent stripped) is mathematically
// zero as written — e.g. "0", "-0", "0.0", "-0.0" — as opposed to a
// syntactically non-zero value that underflows to zero (Core §6.4.2).
const isZeroLiteral = (str: string): boolean => /^0+(\.0+)?$/.test(str.replace(/^-/, '').split(/[eE]/)[0])

/**
 * Attempts to convert a string value to its most natural JavaScript type.
 * Conversion order: null → boolean → number → Date → string (fallback).
 * Strings containing '@' are never parsed as Date (guards email addresses).
 *
 * Null coercion: empty string, 'null', and '~' all become null (YAML-compatible).
 *
 * Hex / octal / binary literals (`0xFF`, `0o77`, `0b1010`) are kept as strings —
 * YAML 1.2 does not define these notations, so converting them silently would
 * diverge from YAML semantics and lose the original representation.
 *
 * Leading decimal point (`.5`) is accepted as a number (→ 0.5) — valid under
 * the Core §6.4.1 grammar's `leading` significand form.
 *
 * All dates are normalized to UTC — see parseDateUTC for details.
 */
const toType = (str: string, strict = false, line = 0): string | boolean | number | Date | null => {
	if (typeof str !== 'string') return str
	if (str === '' || str === 'null' || str === '~') return null
	if (str === 'true') return true
	if (str === 'false') return false
	// Hex (0x/0X), octal (0o/0O), binary (0b/0B) — keep as strings (YAML 1.2 compatible)
	if (str.length > 2 && str.charCodeAt(0) === 48 &&
		(str.charCodeAt(1) === 120 || str.charCodeAt(1) === 88 ||
		 str.charCodeAt(1) === 111 || str.charCodeAt(1) === 79 ||
		 str.charCodeAt(1) === 98  || str.charCodeAt(1) === 66)) return str
	if (NUMBER_RE.test(str)) {
		const n = Number(str)
		if (isFloatForm(str)) {
			if (!Number.isFinite(n)) {
				// Overflow to Infinity/-Infinity (Core §6.4.2)
				if (strict) throw new Error(`LIMA: float value overflows to a non-finite value at line ${line}: "${str}"`)
			} else if (n === 0 && !isZeroLiteral(str)) {
				// Syntactically non-zero value that underflowed to zero (Core §6.4.2)
				if (strict) throw new Error(`LIMA: non-zero float value underflows to zero at line ${line}: "${str}"`)
			} else {
				return n === 0 ? 0 : n // zero normalisation: -0 / -0.0 → +0
			}
		} else if (Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
			return n === 0 ? 0 : n // zero normalisation: -0 → +0
		}
		// Outside the safe integer range, or overflow/underflow in non-strict
		// mode (the throws above already fired in strict mode): fall through
		// to the string fallback below.
	}
	if (!str.includes('@') && DATE_PRE_RE.test(str)) {
		const date = parseDateUTC(str, strict, line)
		if (date !== null) return date
	}
	return str
}

/**
 * Traverses a nested object along a dotted path (`a.b.c` → `obj['a']['b']['c']`).
 * Flat keys (no dot) take a direct lookup fast-path with zero overhead.
 * Returns `undefined` when any segment is missing or non-object.
 */
const getNestedValue = (obj: Meta, path: string): any => {
	if (!path.includes('.')) return obj[path]
	let cur: any = obj
	for (const part of path.split('.')) {
		if (cur === null || typeof cur !== 'object') return undefined
		cur = (cur as Meta)[part]
	}
	return cur
}

/**
 * Resolves references within a value — in two modes:
 *
 * **Pure reference** — the entire value is a single `($key)` or `(%key)`:
 *   - Returns the referenced value as-is, preserving its original type
 *     (number, boolean, Date, array, object).
 *   - Example: `count: ($total)` where total=42 → 42 (number)
 *
 * **String interpolation** — one or more references are embedded in text:
 *   - All `($key)` and `(%key)` occurrences are replaced with their string
 *     representation. Arrays are joined with `', '`.
 *   - The result is always a string (further type coercion is not applied).
 *   - Example: `title: Hello ($firstName)!` → `'Hello Alice!'`
 *   - Unresolvable references are left unchanged in the output.
 *
 * `($key)` supports dotted paths to address nested values: `($site.default.claim)`.
 *
 * Returns the original value unchanged if no references are present.
 */

/**
 * Canonical string representation for interpolation (References §3.5.1).
 * `Number.prototype.toString` already picks the correct fixed-vs-exponential
 * form and digit sequence (ECMAScript is the normative algorithm) — this
 * only applies the lexical cleanup the spec requires on top: lowercase `e`,
 * no `+` after `e`, no leading zeros in the exponent.
 */
const canonicalString = (value: any): string => {
	// References §3.5: null's canonical string representation is empty —
	// the token is replaced with nothing, not the text "null".
	if (value === null) return ''
	// References §3.5: a UTC Instant's canonical string is an RFC 3339
	// string with seconds and a Z suffix (e.g. "2024-03-01T09:00:00Z") —
	// never the host's locale/timezone-dependent String(date) form, and
	// never toISOString()'s trailing ".000" milliseconds (Lima instants
	// are always zero-millisecond, but the canonical form omits them).
	if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
	if (typeof value !== 'number') return String(value)
	const s = String(value)
	return s.includes('e') || s.includes('E')
		? s.replace(/[eE]\+?(-?)0*(\d+)/, 'e$1$2')
		: s
}

/**
 * A reference is only resolved from a target that is itself reference-free
 * (References §4: "A reference is resolved only if its target was
 * reference-free before the current phase began"). Without this check, a
 * chain like `a: ($b)` / `b: ($c)` could alias `a` to `b`'s still-unresolved
 * token text instead of correctly leaving `a` unresolved (References §3.7,
 * one-hop limit).
 */
const isReferenceFree = (value: any): boolean => {
	if (isInactiveValue(value)) return true
	if (typeof value === 'string') return !value.includes('($') && !value.includes('(%')
	if (Array.isArray(value)) return value.every(isReferenceFree)
	if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
		return Object.values(value).every(isReferenceFree)
	}
	return true
}

/** A mapping, as opposed to an array, Date, or scalar. */
const isPlainMapping = (value: any): boolean =>
	value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)

const resolve = (val: string, metadata: Meta, partials: Meta, line = 0): any => {
	if (!val || typeof val !== 'string') return val

	// Pure reference: entire value is exactly one ($path) or (%key).
	// CharCode pre-check avoids running the regex on values that don't start
	// with '(' (40) and end with ')' (41) — the common case for normal strings.
	// The bare `%key` shorthand (no parentheses) from the pre-1.0 legacy
	// parser is intentionally not supported — References 1.0 Appendix:
	// "%key shorthand without parentheses | Removed; (%key) is the only
	// partial syntax."
	const pureMatch =
		val.charCodeAt(0) === 40 /* '(' */ && val.charCodeAt(val.length - 1) === 41 /* ')' */
			? val.match(PURE_REF_RE)
			: null
	if (pureMatch) {
		const isPartial = pureMatch[2] !== undefined
		const key = (isPartial ? pureMatch[2] : pureMatch[1])!
		const resolved = isPartial ? partials[key] : getNestedValue(metadata, key)
		if (resolved !== undefined && isReferenceFree(resolved)) return deepCopyLimaValue(resolved)
		// Unresolved (or target not yet reference-free) — leave unchanged;
		// strict check happens after the second pass
	}

	// String interpolation: replace all ($path) / (%key) occurrences
	if (val.includes('($') || val.includes('(%')) {
		return val.replace(INTERP_RE, (match, docPath, partialKey) => {
			const isPartial = partialKey !== undefined
			const key = isPartial ? partialKey : docPath
			const resolved = isPartial ? partials[key] : getNestedValue(metadata, key)
			// References §3.5: null is a valid, resolved interpolation value —
			// it becomes an empty string, not "unresolved" fallback text. Only
			// undefined (target not found) or a still-active target leaves the
			// token unchanged.
			if (resolved === undefined || !isReferenceFree(resolved)) return match
			// Consumed here and now (never stored as a further resolution
			// target), so it's safe to strip any partial-provenance inactive
			// markers (§3.8) via the non-mutating unwrap — canonicalString/
			// isPlainMapping/Array.isArray must see plain values, not marker
			// wrapper objects, and the shared sanitized `partials` map must
			// stay marked for any other reference to the same partial.
			const plain = unwrapInactiveReadonly(resolved)
			// References §3.5/§3.6: mappings can never be interpolated into a
			// string, and arrays containing a nested array or mapping element
			// throw too — both are hard errors in both modes. Collected rather
			// than thrown immediately (§5: error ordering by source position;
			// see collectedRefErrors) — `match` is a safe placeholder since a
			// collected error always aborts the parse once resolution ends.
			if (isPlainMapping(plain)) {
				collectedRefErrors.push({ line, message: `LIMA: invalid interpolation of "${match}" at line ${line}: mapping cannot be interpolated into a string` })
				return match
			}
			if (Array.isArray(plain)) {
				if (plain.some((item) => Array.isArray(item) || isPlainMapping(item))) {
					collectedRefErrors.push({ line, message: `LIMA: invalid interpolation of "${match}" at line ${line}: array contains a nested array or mapping` })
					return match
				}
				return plain.map(canonicalString).join(', ')
			}
			return canonicalString(plain)
		})
	}

	return val
}

/**
 * Strips a trailing inline comment from a single-line value.
 * A comment begins at the first `#` that is neither inside a quoted string nor
 * backslash-escaped. Quoted regions (single or double quotes, with `\"` / `\'`
 * escape support) are scanned character-by-character and skipped entirely.
 *
 * Examples:
 * - `Hello World  # comment`            → `Hello World`
 * - `https://example.com/page#section`  → `https://example.com/page`
 * - `"https://example.com/page#section" # note` → `"https://example.com/page#section"`
 * - `# comment at start`                → `` (empty string → null after resolveValue)
 * - `\# not a comment`                  → `#` (backslash-escaped, kept and unescaped)
 */
const stripComment = (val: string): string => {
	let quote = 0 // char code of the opening quote, 0 = unquoted
	for (let i = 0; i < val.length; i++) {
		const cc = val.charCodeAt(i)
		if (quote) {
			if (cc === 92 /* '\\' */) i++ // skip escaped char inside quoted string
			else if (cc === quote) quote = 0
		} else if (cc === 34 /* '"' */ || cc === 39 /* "'" */) {
			quote = cc
		} else if (cc === 92 /* '\\' */ && val.charCodeAt(i + 1) === 35 /* '#' */) {
			i++ // skip \# — will be unescaped below
		} else if (cc === 35 /* '#' */) {
			return val.slice(0, i).trimEnd().replace(ESCAPED_HASH_RE, '#')
		}
	}
	return val.replace(ESCAPED_HASH_RE, '#')
}

/**
 * Decodes backslash escape sequences in the body of a double-quoted string
 * (after the surrounding `"..."` delimiters have been stripped).
 *
 * Supported sequences (YAML 1.2 + JSON):
 *   `\\ \" \/ \b \f \n \r \t \0`
 *   `\uXXXX`  — Unicode BMP code point (4 hex digits)
 *   `\UXXXXXXXX` — Unicode supplementary code point (8 hex digits)
 *   `\xXX`    — Latin-1 hex escape (2 hex digits)
 *
 * Fast-path: if the string contains no `\`, it is returned unchanged without
 * running the regex — the common case for most quoted values.
 *
 * Unknown sequences are left intact (backslash preserved). Single-quoted strings
 * use a different quoting rule (`\'` only) and are not handled here.
 */
const unescapeDQ = (s: string, strict = false, line = 0): string => {
	if (!s.includes('\\')) return s
	if (strict) {
		// Core §10.1: an unknown or semantically invalid escape sequence
		// (unknown char, incomplete/invalid hex, out-of-range \U, or a
		// surrogate \u) throws in strict mode — non-strict already leaves
		// it intact via the replace below.
		for (const m of s.matchAll(ANY_ESCAPE_RE)) {
			if (!isValidEscape(m[0].slice(1))) {
				throw new Error(`LIMA: unknown escape sequence "${m[0]}" at line ${line}`)
			}
		}
	}
	return s.replace(ANY_ESCAPE_RE, (full) => {
		const e = full.slice(1)
		if (!isValidEscape(e)) return full // leave intact — invalid or unknown
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

/**
 * Resolves and type-coerces a scalar value — the standard path for any plain value.
 *
 * **Quoted strings** (single `'` or double `"` delimiters, matching) are stripped
 * of their delimiters and returned as a plain string. No reference resolution, no
 * type coercion is applied — consistent with YAML semantics and with the handling
 * inside `parseFlowSequence` / `parseFlowMapping`.
 *
 * Examples:
 *   `'"hello"'`   → `'hello'`   (quoted — strip delimiters only)
 *   `'"42"'`      → `'42'`      (quoted — stays string, no coercion)
 *   `'42'`        → `42`        (number via toType)
 *   `'($key)'`    → resolved    (pure reference via resolve)
 */
const resolveValue = (raw: string, metadata: Meta, partials: Meta, strict = false, line = 0): any => {
	const first = raw.charCodeAt(0)
	if (strict && (first === 91 /* '[' */ || first === 123 /* '{' */)) {
		// Both parseFlowSequence and parseFlowMapping already returned null
		// before this fallback was reached, and — in strict mode — every
		// other flow-syntax problem throws directly from inside those two
		// functions. The only way to still land here with a value starting
		// with `[`/`{` is a missing closing bracket (Core §7.4/§7.5:
		// "Unclosed [: ... strict — throw" / "An unclosed {: ... strict —
		// throw"), reported at the line of the opening bracket.
		throw new Error(`LIMA: unclosed flow ${first === 91 ? 'sequence' : 'mapping'} at line ${line}`)
	}
	if (first === 34 /* '"' */ || first === 39 /* "'" */) {
		if (raw.charCodeAt(raw.length - 1) === first) {
			const unquoted = raw.slice(1, -1)
			const value = first === 34 ? unescapeDQ(unquoted, strict, line) : unquoted.replace(/\\'/g, "'")
			checkScalarLimit(value, line)
			// §2.3: quoted content is always inactive. Only wrap when it could be
			// mistaken for a reference later — an ordinary quoted string is
			// already safe without the extra indirection.
			return value.includes('($') || value.includes('(%') ? markInactive(value) : value
		}
		// Core §4 rule 4 / §10.1: a value starting with a quote character is
		// a quoted value only when the matching closing quote is the final
		// character. Anything else — trailing content after the closing
		// quote, or no closing quote at all (unterminated) — falls back to
		// treating the whole remaining text as a string in non-strict mode
		// (the toType(resolve(...)) path below already does exactly that,
		// since neither case matches null/boolean/number/date) and throws
		// in strict mode.
		if (strict) {
			throw new Error(`LIMA: non-whitespace content after closing quote at line ${line}`)
		}
	}
	const value = toType(resolve(raw, metadata, partials, line), strict, line)
	checkScalarLimit(value, line)
	return value
}

/**
 * Splits a flow-sequence/flow-mapping body on commas that are outside
 * quoted strings and outside any nested `[...]`/`{...}` construct. Supports
 * both single and double quotes. Backslash-escaped quotes inside strings
 * (e.g. `\"` inside a double-quoted string) are correctly skipped.
 *
 * Bracket-depth tracking (Core §7.4/§7.5) keeps a nested flow construct's
 * own commas from being mistaken for top-level separators — without it,
 * `[{name: Home, url: /}, {name: About, url: /about}]` would incorrectly
 * split into four pieces instead of two.
 *
 * Examples:
 *   `a, "b, c", d`              → `['a', '"b, c"', 'd']`
 *   `"He said \"Hi\"", next`    → `['"He said \\"Hi\\"", 'next']`
 *   `{a: 1, b: 2}, {c: 3}`      → `['{a: 1, b: 2}', '{c: 3}']`
 */
const splitFlowItems = (inner: string): string[] => {
	const items: string[] = []
	let start = 0
	let quote = 0 // char code of opening quote, 0 = unquoted
	let depth = 0 // nesting depth of [...] / {...}, tracked outside quotes
	for (let i = 0; i < inner.length; i++) {
		const cc = inner.charCodeAt(i)
		if (quote) {
			if (cc === 92 /* '\\' */) { i++ } // skip escaped char
			else if (cc === quote) quote = 0
		} else if (cc === 34 /* '"' */ || cc === 39 /* "'" */) {
			quote = cc
		} else if (cc === 91 /* '[' */ || cc === 123 /* '{' */) {
			depth++
		} else if (cc === 93 /* ']' */ || cc === 125 /* '}' */) {
			depth--
		} else if (cc === 44 /* ',' */ && depth === 0) {
			items.push(inner.slice(start, i).trim())
			start = i + 1
		}
	}
	items.push(inner.slice(start).trim())
	return items
}

/** Whether a trimmed flow item is itself a nested `[...]` or `{...}` construct. */
const isNestedFlowConstruct = (item: string): boolean =>
	(item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) ||
	(item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125)

/**
 * Parses a YAML flow sequence (also called "flow array") if the value is
 * enclosed in square brackets: `[one, two, three]`.
 *
 * **Terminology:** The YAML 1.2 specification calls this a *flow sequence* —
 * the inline counterpart to the block sequence (dash-prefixed lines).
 * "Flow array" is the widely used informal name for the same thing.
 *
 * This syntax is fully YAML-compatible and therefore also understood by tools
 * like Obsidian, which parse frontmatter as YAML.
 *
 * Examples:
 *   `[one, two, three]`     → `['one', 'two', 'three']`
 *   `[1, 2, 3]`             → `[1, 2, 3]`
 *   `[true, false]`         → `[true, false]`
 *   `[]`                    → `[]`
 *
 * Returns `null` if the value is not a flow sequence.
 */
const parseFlowSequence = (val: string, metadata: Meta, partials: Meta, strict = false, line = 0): any[] | null => {
	if (val.charCodeAt(0) !== 91 /* '[' */ || val.charCodeAt(val.length - 1) !== 93 /* ']' */) return null
	const inner = val.slice(1, -1).trim()
	if (!inner) return []
	const rawItems = splitFlowItems(inner)

	// Trailing comma (Core §7.4): its own rule, distinct from the
	// leading/consecutive empty-element rule below. Non-strict drops the
	// resulting trailing empty element entirely rather than turning it into
	// a null item; strict falls through to the same throw as any other
	// empty element, since it's still the last element at this point.
	if (!strict && rawItems.length > 1 && !rawItems[rawItems.length - 1]) rawItems.pop()

	return rawItems.map((item) => {
		// Empty element (leading/consecutive comma, or a strict-mode
		// trailing comma) — Core §7.4/§10.1: non-strict falls back to null,
		// strict throws.
		if (!item) {
			if (strict) throw new Error(`LIMA: empty element in flow sequence at line ${line}`)
			return null
		}
		if (item.charCodeAt(0) === 91 /* '[' */ && item.charCodeAt(item.length - 1) === 93 /* ']' */) {
			// Core §7.4: a flow sequence may never contain another flow
			// sequence, directly or via an intermediate flow mapping — this
			// throws in BOTH modes, unlike most flow errors.
			throw new Error(`LIMA: nested flow sequence not permitted at line ${line}: "${item}"`)
		}
		if (item.charCodeAt(0) === 123 /* '{' */ && item.charCodeAt(item.length - 1) === 125 /* '}' */) {
			// Core §7.4: a flow sequence may contain flow mappings one level
			// deep. parseFlowMapping itself rejects any further nesting
			// inside that mapping's own values (§7.5), which also covers
			// the SEQ → MAP → SEQ (depth 2) case.
			const nested = parseFlowMapping(item, metadata, partials, strict, line)
			if (nested !== null) return nested
			// Malformed nested mapping (e.g. missing ": ") falls through to
			// the same handling as any other item below.
		}
		// Quoted string: strip delimiters, return as string — no type coercion.
		// Consistent with YAML: `"42"` → '42' (string), not 42 (number).
		const first = item.charCodeAt(0)
		if ((first === 34 || first === 39) && item.charCodeAt(item.length - 1) === first) {
			const unquoted = item.slice(1, -1)
			const value = first === 34 ? unescapeDQ(unquoted, strict, line) : unquoted.replace(/\\'/g, "'")
			checkScalarLimit(value, line)
			return value.includes('($') || value.includes('(%') ? markInactive(value) : value
		}
		const resolved = resolve(item, metadata, partials, line)
		if (Array.isArray(resolved)) {
			// References Appendix: array spreading was removed, and a nested
			// array produced by reference insertion violates Core §7.2
			// ("sequences contain scalars or mappings only") — throws in BOTH
			// modes (R-036/R-143). Collected rather than thrown immediately
			// (§5 error ordering — see collectedRefErrors); `item` (the raw
			// token text) is a safe placeholder either way.
			collectedRefErrors.push({ line, message: `LIMA: reference "${item}" resolves to an array, which cannot be inserted as a sequence item at line ${line}` })
			return item
		}
		const value = toType(resolved, strict, line)
		checkScalarLimit(value, line)
		return value
	})
}

/**
 * Parses a YAML flow mapping if the value is enclosed in curly braces: `{key: val, key2: val2}`.
 *
 * **Terminology:** The YAML 1.2 specification calls this a *flow mapping* —
 * the inline counterpart to the block mapping (indented key-value lines).
 *
 * Examples:
 *   `{name: Alice, role: editor}`    → `{ name: 'Alice', role: 'editor' }`
 *   `{count: 42, active: true}`      → `{ count: 42, active: true }`
 *   `{}`                             → `{}`
 *   `"42"` inside → string (no type coercion, consistent with flow sequence)
 *
 * Returns `null` if the value is not a flow mapping (wrong delimiters or any
 * item lacks a `: ` separator, in which case the caller falls back to string handling).
 */
const parseFlowMapping = (val: string, metadata: Meta, partials: Meta, strict = false, line = 0): Meta | null => {
	if (val.charCodeAt(0) !== 123 /* '{' */ || val.charCodeAt(val.length - 1) !== 125 /* '}' */) return null
	const inner = val.slice(1, -1).trim()
	if (!inner) return emptyMapping()
	const result: Meta = emptyMapping()
	for (const item of splitFlowItems(inner)) {
		// Empty element (leading/consecutive/trailing comma) — Core §7.5:
		// non-strict skips it, strict throws. Distinct from a genuinely
		// malformed non-empty item (handled below), which falls back the
		// entire mapping to a string instead.
		if (!item) {
			if (strict) throw new Error(`LIMA: empty element in flow mapping at line ${line}`)
			continue
		}
		const colonPos = item.indexOf(': ')
		if (colonPos === -1) {
			if (strict) throw new Error(`LIMA: invalid flow mapping item (missing ": ") at line ${line}: "${item}"`)
			return null // not a valid flow mapping — fall back to string
		}
		const key    = stripKeyQuotes(item.slice(0, colonPos).trim())
		checkKeyLength(key, line)
		checkDuplicateKey(result, key, line, strict)
		const rawVal = item.slice(colonPos + 2).trim()
		if (isNestedFlowConstruct(rawVal)) {
			// Core §7.5: a flow mapping may never contain another flow
			// mapping or flow sequence — throws in BOTH modes, no fallback.
			throw new Error(`LIMA: invalid flow nesting at line ${line}: "${rawVal}"`)
		}
		const first  = rawVal.charCodeAt(0)
		// Quoted string: strip delimiters and unescape, return as string — no type coercion.
		if ((first === 34 /* '"' */ || first === 39 /* "'" */) && rawVal.charCodeAt(rawVal.length - 1) === first) {
			const unquoted = rawVal.slice(1, -1)
			const value = first === 34 ? unescapeDQ(unquoted, strict, line) : unquoted.replace(/\\'/g, "'")
			checkScalarLimit(value, line)
			result[key] = value.includes('($') || value.includes('(%') ? markInactive(value) : value
		} else {
			const value = toType(resolve(rawVal, metadata, partials, line), strict, line)
			checkScalarLimit(value, line)
			result[key] = value
		}
	}
	return result
}

// ─── Block parser ─────────────────────────────────────────────────────────────

/**
 * Finds the position of the `: ` key–value separator in a block line,
 * correctly skipping over quoted keys so that a colon inside a key name
 * (e.g. `'url: path': value`) is never mistaken for the separator.
 *
 * For unquoted keys the result is identical to `s.indexOf(': ')`.
 * Returns -1 when no separator is found.
 */
const findKeySep = (s: string): number => {
	const first = s.charCodeAt(0)
	if (first === 39 /* "'" */ || first === 34 /* '"' */) {
		let i = 1
		while (i < s.length && s.charCodeAt(i) !== first) i++
		// Separator must be ': ' immediately after the closing quote
		if (s.charCodeAt(i + 1) === 58 /* ':' */ && s.charCodeAt(i + 2) === 32 /* ' ' */) return i + 1
		return -1
	}
	return s.indexOf(': ')
}

/**
 * Strips matching surrounding quote characters from a key token if present;
 * otherwise returns the string unchanged.
 *
 * `'my key'` → `my key`   (single-quoted)
 * `"my key"` → `my key`   (double-quoted)
 * `title`    → `title`    (unquoted — returned as-is)
 */
const stripKeyQuotes = (s: string): string => {
	const f = s.charCodeAt(0)
	if (f === 39 && s.charCodeAt(s.length - 1) === 39) return s.slice(1, -1)
	if (f === 34 && s.charCodeAt(s.length - 1) === 34) return unescapeDQ(s.slice(1, -1))
	return s
}

/**
 * Recursively parses a block value (array or map) from an array of lines.
 *
 * Each call handles one indentation level. When a key has no inline value and
 * the next non-empty line is more deeply indented, the function recurses to
 * parse the nested block, enabling arbitrary nesting depth.
 *
 * @param lines      Full array of block lines (normalized, not trimmed)
 * @param startIdx   Index of the first line this call should process
 * @param baseIndent Indentation column for entries at this depth
 * @param metadata   Top-level parsed metadata (for reference resolution)
 * @param partials   External partials (for reference resolution)
 * @param strict     When true, throw on unrecognised syntax instead of skipping
 * @returns `value` (the parsed result) and `nextIdx` (first unconsumed line index)
 */
const parseBlock = (
	lines: string[],
	startIdx: number,
	baseIndent: number,
	metadata: Meta,
	partials: Meta,
	strict = false,
	baseLine = 0,
): { value: any[] | Meta | null; nextIdx: number } => {
	let result: any[] | Meta | null = null
	let pendingItem: Meta | null = null
	let idx = startIdx

	while (idx < lines.length) {
		const line    = lines[idx]
		const trimmed = line.trimStart()
		if (!trimmed) { idx++; continue } // skip whitespace-only lines
		if (trimmed.charCodeAt(0) === 35) { idx++; continue } // skip comment lines (#)

		const indent = line.length - trimmed.length

		if (indent < baseIndent) break // line belongs to a shallower level

		if (indent > baseIndent) {
			// Deeper than base — continuation keys of a multi-key array item
			if (Array.isArray(result) && pendingItem !== null) {
				const colonPos = findKeySep(trimmed)
				if (colonPos !== -1) {
					const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
					checkKeyLength(itemKey, baseLine + idx)
					// Core §8: comments are stripped from inline values at every level,
					// including array-item continuation keys — not just top-level scalars.
					const itemVal = stripComment(trimmed.slice(colonPos + 2).trim())
					const flowSeq = parseFlowSequence(itemVal, metadata, partials, strict, baseLine + idx)
					const flowMap = flowSeq === null ? parseFlowMapping(itemVal, metadata, partials, strict, baseLine + idx) : null
					pendingItem[itemKey] = flowSeq !== null ? flowSeq : (flowMap !== null ? flowMap : resolveValue(itemVal, metadata, partials, strict, baseLine + idx))
					idx++
				} else if (trimmed.endsWith(':')) {
					// Nested block within an array item's continuation
					const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
					checkKeyLength(itemKey, baseLine + idx)
					idx++
					let ni = idx
					while (ni < lines.length && !lines[ni].trim()) ni++
					if (ni < lines.length) {
						const nextIndent = lines[ni].length - lines[ni].trimStart().length
						if (nextIndent > indent) {
							const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, metadata, partials, strict, baseLine)
							pendingItem[itemKey] = nested
							idx = after
							continue
						}
					}
					pendingItem[itemKey] = null
				} else {
					if (strict) throw new Error(`LIMA: unexpected syntax in array item continuation at line ${baseLine + idx}: "${trimmed}"`)
					idx++ // unrecognized continuation line — skip
				}
			} else {
				if (strict) throw new Error(`LIMA: unexpected indentation at line ${baseLine + idx}: "${trimmed}"`)
				idx++ // unexpected depth — skip
			}
			continue
		}

		// ── indent === baseIndent ────────────────────────────────────────────────
		const isList = trimmed.charCodeAt(0) === 45 // '-'

		if (isList) {
			// Flush the previous multi-key object item before starting a new one
			if (pendingItem !== null) {
				(result as any[]).push(pendingItem)
				pendingItem = null
			}

			if (!result) result = []
			if (!Array.isArray(result)) {
				if (strict) throw new Error(`LIMA: mixed array and map entries for the same key at line ${baseLine + idx}`)
				idx++; continue
			}

			// A bare '-' (no whitespace after) is a null item — DASH_PREFIX_RE requires \s+
			// so it wouldn't match, leaving '-' as the value instead of ''.
			const afterDash = trimmed === '-' ? '' : stripComment(trimmed.replace(DASH_PREFIX_RE, ''))
			const flowMap   = parseFlowMapping(afterDash, metadata, partials, strict, baseLine + idx)
			const colonPos  = findKeySep(afterDash)

			if (flowMap !== null) {
				// Flow mapping item: - {key: val, key2: val2}
				result.push(flowMap)
				idx++
			} else if (afterDash === '-' || DASH_PREFIX_RE.test(afterDash)) {
				// Core §7.2: nested block sequences (array-in-array) are not
				// supported. Non-strict: the entire nested sequence block is
				// consumed and represented by a single null item — its
				// subsequent, more deeply indented lines must not be
				// reinterpreted as siblings of the outer sequence. Strict: throw.
				if (strict) throw new Error(`LIMA: nested block sequence at line ${baseLine + idx}: "${trimmed}"`)
				result.push(null)
				idx++
				while (idx < lines.length) {
					const nextTrimmed = lines[idx].trimStart()
					if (!nextTrimmed || nextTrimmed.charCodeAt(0) === 35) { idx++; continue }
					if (lines[idx].length - nextTrimmed.length <= baseIndent) break
					idx++
				}
			} else if (colonPos !== -1) {
				// Object item with inline value — may accumulate more keys via continuation lines
				const pendingKey = stripKeyQuotes(afterDash.slice(0, colonPos).trim())
				checkKeyLength(pendingKey, baseLine + idx)
				const pendingRaw = afterDash.slice(colonPos + 2).trim()
				const pendingFlowSeq = parseFlowSequence(pendingRaw, metadata, partials, strict, baseLine + idx)
				const pendingFlowMap = pendingFlowSeq === null ? parseFlowMapping(pendingRaw, metadata, partials, strict, baseLine + idx) : null
				pendingItem = emptyMapping()
				pendingItem[pendingKey] = pendingFlowSeq !== null ? pendingFlowSeq : (pendingFlowMap !== null ? pendingFlowMap : resolveValue(pendingRaw, metadata, partials, strict, baseLine + idx))
				idx++
			} else if (afterDash.endsWith(':')) {
				// Object item whose value is a nested block
				const itemKey = stripKeyQuotes(afterDash.slice(0, -1).trim())
				checkKeyLength(itemKey, baseLine + idx)
				idx++
				let ni = idx
				while (ni < lines.length && !lines[ni].trim()) ni++
				if (ni < lines.length) {
					const nextIndent = lines[ni].length - lines[ni].trimStart().length
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, metadata, partials, strict, baseLine)
						pendingItem = emptyMapping()
						pendingItem[itemKey] = nested
						idx = after
						continue
					}
				}
				pendingItem = emptyMapping()
				pendingItem[itemKey] = null
			} else {
				// Plain scalar item — push immediately (cannot accumulate further keys)
				const qFirst = afterDash.charCodeAt(0)
				if ((qFirst === 34 || qFirst === 39) && afterDash.charCodeAt(afterDash.length - 1) === qFirst) {
					// Quoted string: strip delimiters, unescape, no type coercion
					const inner = afterDash.slice(1, -1)
					const value = qFirst === 34 ? unescapeDQ(inner, strict, baseLine + idx) : inner.replace(/\\'/g, "'")
					checkScalarLimit(value, baseLine + idx)
					;(result as any[]).push(value.includes('($') || value.includes('(%') ? markInactive(value) : value)
				} else {
					const resolvedVal = resolve(afterDash, metadata, partials, baseLine + idx)
					if (Array.isArray(resolvedVal)) {
						// References Appendix: array spreading was removed, and a
						// nested array produced by reference insertion violates
						// Core §7.2 ("sequences contain scalars or mappings
						// only") — throws in BOTH modes (R-036/R-143). Collected
						// rather than thrown immediately (§5 error ordering —
						// see collectedRefErrors).
						collectedRefErrors.push({ line: baseLine + idx, message: `LIMA: reference "${afterDash}" resolves to an array, which cannot be inserted as a sequence item at line ${baseLine + idx}` })
						;(result as any[]).push(afterDash)
					} else {
						const value = toType(resolvedVal, strict, baseLine + idx)
						checkScalarLimit(value, baseLine + idx)
						;(result as any[]).push(value)
					}
				}
				idx++
			}
		} else {
			// ── Map entry ───────────────────────────────────────────────────────
			// `result` is only created once a line is confirmed to actually
			// contribute a map entry (below) — not eagerly here. Core §6.1.5 /
			// §10.1: indented freetext with no `:` and no `|` marker is not a
			// valid multi-line string; the key's value must stay `null` in
			// non-strict mode, which requires `result` to still be `null` when
			// every line at this level turns out to be unrecognized.
			if (Array.isArray(result)) {
				if (strict) throw new Error(`LIMA: mixed map and array entries for the same key at line ${baseLine + idx}`)
				idx++; continue
			}

			const colonPos = findKeySep(trimmed)
			if (colonPos !== -1) {
				if (!result) result = emptyMapping()
				const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
				checkKeyLength(itemKey, baseLine + idx)
				checkDuplicateKey(result as Meta, itemKey, baseLine + idx, strict)
				// Core §8: comments are stripped from inline values at every level,
				// including nested block-mapping entries — not just top-level scalars.
				const itemVal = stripComment(trimmed.slice(colonPos + 2).trim())
				const flowSeq = parseFlowSequence(itemVal, metadata, partials, strict, baseLine + idx)
				const flowMap = flowSeq === null ? parseFlowMapping(itemVal, metadata, partials, strict, baseLine + idx) : null
				;(result as Meta)[itemKey] = flowSeq !== null ? flowSeq : (flowMap !== null ? flowMap : resolveValue(itemVal, metadata, partials, strict, baseLine + idx))
				idx++
			} else if (trimmed.endsWith(':')) {
				if (!result) result = emptyMapping()
				// Key with no inline value → check for a nested block on the next lines
				const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
				checkKeyLength(itemKey, baseLine + idx)
				checkDuplicateKey(result as Meta, itemKey, baseLine + idx, strict)
				idx++
				let ni = idx
				while (ni < lines.length && !lines[ni].trim()) ni++
				if (ni < lines.length) {
					const nextIndent = lines[ni].length - lines[ni].trimStart().length
					if (nextIndent > baseIndent) {
						const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, metadata, partials, strict, baseLine)
						;(result as Meta)[itemKey] = nested
						idx = after
						continue
					}
				}
				;(result as Meta)[itemKey] = null
			} else {
				// Core §6.1.5: indented freetext without a `|` marker. Non-strict:
				// leave `result` as-is (stays `null` unless a real entry already
				// exists at this level). Strict: throw — Core §10.1 lists this as
				// its own strict-error row, distinct from other block-structure
				// errors, but closest in kind to INVALID_INDENTATION (the codes
				// stay deliberately coarse, per docs/corpus-design/error-api.md).
				if (strict) throw new Error(`LIMA: indented freetext without a block scalar marker at line ${baseLine + idx}: "${trimmed}"`)
				idx++ // unrecognized line — skip
			}
		}
	}

	// Flush the final buffered multi-key array item
	if (pendingItem !== null) (result as any[]).push(pendingItem)

	return { value: result, nextIdx: idx }
}

/**
 * Recursively resolves any remaining reference strings after the initial parse pass.
 * Used for forward references — `($key)` referring to a key that appears later in the
 * document. Only re-processes values that actually contain reference syntax.
 *
 * Handles references nested inside arrays and maps, not just top-level scalars.
 *
 * Note: self-references (`a: ($a)`) and circular references remain unchanged —
 * the resolved value is the string `'($a)'` itself, so the second lookup returns
 * the same string and the loop terminates naturally.
 */
const resolveForward = (val: any, metadata: Meta, partials: Meta, strict = false, line = 0): any => {
	if (isInactiveValue(val)) return val // quoted at parse time — literal, never re-resolved (§2.3)
	if (typeof val === 'string' && (val.includes('($') || val.includes('(%'))) {
		return toType(resolve(val, metadata, partials, line), strict, line)
	}
	if (Array.isArray(val)) {
		return val.map((item) => resolveForward(item, metadata, partials, strict, line))
	}
	if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
		for (const k of Object.keys(val)) {
			val[k] = resolveForward(val[k], metadata, partials, strict, line)
		}
	}
	return val
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parses a LIMA frontmatter string into a plain object.
 *
 * @param frontMatter  Raw LIMA content (without the --- delimiters)
 * @param options      Optional: `partials` (named values for (%key) references)
 *                     and `strict` (throw on unresolvable references or invalid syntax)
 * @returns            A plain object with all parsed key-value pairs
 */
const parse = <T extends Record<string, unknown> = Meta>(
	frontMatter: string,
	options?: ParseOptions
): T => {
	// References §5: fresh collection for this call — see collectedRefErrors's
	// declaration for why this is module-level state rather than a parameter.
	collectedRefErrors = []
	const rawPartials = options?.partials ?? {}
	const strict      = options?.strict   ?? false

	// References §6.2: partials are validated before document parsing begins —
	// this must run even for an empty document. Partial-validation errors
	// (including these resource-limit ones) never carry a document line —
	// they cannot, since document parsing has not started yet.
	const partialNames = Object.keys(rawPartials)
	if (partialNames.length > PARTIAL_COUNT_LIMIT) {
		throw new Error(`LIMA: too many partials (max ${PARTIAL_COUNT_LIMIT})`)
	}
	for (const name of partialNames) {
		if ([...name].length > PARTIAL_NAME_LENGTH_LIMIT) {
			throw new Error(`LIMA: invalid partial "${name}" at path "${name}": name exceeds maximum length of ${PARTIAL_NAME_LENGTH_LIMIT} code points`)
		}
	}
	for (const [name, value] of Object.entries(rawPartials)) validatePartialValue(value, name, name)
	// Total value nodes across ALL partials combined, not per partial —
	// summed only after every individual partial has already passed value-
	// model validation above.
	const totalPartialNodes = Object.values(rawPartials).reduce((sum: number, v) => sum + countValueNodes(v), 0)
	if (totalPartialNodes > PARTIAL_NODE_LIMIT) {
		throw new Error(`LIMA: partials exceed the combined maximum of ${PARTIAL_NODE_LIMIT} value nodes`)
	}
	// §3.8: every string leaf is marked inactive up front (see
	// sanitizePartialValue's doc comment) so no later resolution step can
	// mistake literal partial content for an active reference token.
	const partials: Meta = emptyMapping()
	for (const [name, value] of Object.entries(rawPartials)) partials[name] = sanitizePartialValue(value)

	// Core §9: document size is measured in UTF-8 bytes of the *original*
	// input, before normalisation — a hard error in both modes.
	if (byteLength(frontMatter) > DOCUMENT_SIZE_LIMIT) {
		throw new Error(`LIMA: document exceeds maximum size of ${DOCUMENT_SIZE_LIMIT} bytes at line 1`)
	}

	if (!frontMatter) return emptyMapping() as unknown as T

	// Normalize (Core §3), in order:
	//   1. \r\n → \n, then any remaining standalone \r → \n.
	//   2. Tabs in *leading* indentation only → two spaces each; tabs
	//      elsewhere (inside scalar content) are left unchanged. A single
	//      combined `\r\n|\t` pass here previously converted every tab in
	//      the document, including ones inside scalar values — wrong.
	//   3. Trailing spaces stripped per line.
	frontMatter = frontMatter
		.replace(/\r\n|\r/g, '\n')
		.replace(/^([ \t]*)/gm, (leading) => (leading.includes('\t') ? leading.replace(/\t/g, '  ') : leading))
		.replace(/ +(?=\n|$)/gm, '')

	// Lazy key-position map — populated only when a line number is actually needed
	// (duplicate-key warning/throw, strict-mode errors). Zero overhead on the happy path.
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

	// Quick scan for reference syntax — if absent we can skip the entire second pass.
	const hasRefs = frontMatter.includes('($') || frontMatter.includes('(%')

	// Core §5.2: a space between a quoted key's closing quote and the colon
	// throws in strict mode. Such a line never matches KEY_RE, so without
	// this check it would silently fall through as an "unrecognized line"
	// (correct for non-strict — §4 — but not for strict here). Gated behind
	// `strict` to keep the non-strict happy path free of this scan.
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

	// Split on keys. KEY_RE has 4 capture groups:
	//   g1: unquoted key  g2: single-quoted key  g3: double-quoted key  g4: separator
	// After slice(1) the parts array repeats every 5 elements:
	//   i*5+0 → unquoted key name (undefined when key is quoted)
	//   i*5+1 → single-quoted key content (undefined otherwise)
	//   i*5+2 → double-quoted key content (undefined otherwise)
	//   i*5+3 → separator ('\n'-terminated = block, ' ' = inline)
	//   i*5+4 → raw value string
	const parts    = frontMatter.split(KEY_RE).slice(1)
	const keyCount = parts.length / 5 | 0

	if (keyCount === 0) return emptyMapping() as unknown as T

	// Core §9: top-level key entries, counted before duplicate resolution —
	// each occurrence (including duplicates) counts toward the budget.
	if (keyCount > TOP_LEVEL_KEY_LIMIT) {
		throw new Error(`LIMA: too many top-level key entries (max ${TOP_LEVEL_KEY_LIMIT}) at line 1`)
	}

	const metadata: Meta = emptyMapping()
	// Top-level key name → its occurrence index, for on-demand line lookups
	// (e.g. the final unresolved-reference scan below) without eagerly
	// computing positions for every key.
	const keyIndexByName: Record<string, number> = {}
	// References §4/§3.7 (one-hop limit): top-level key name → its ORIGINAL
	// raw text, for every key whose inline value is itself a pure reference
	// token. The live first pass below resolves backward references (a key
	// targeting an earlier key) as it goes, so by the time a later key looks
	// up an earlier one, the earlier key's value may already be resolved —
	// correct for that earlier key's own output, but if used as-is when
	// building the phase-2 snapshot, it would let a chain like `a: ($b)` /
	// `b: ($c)` / `c: 42` fully resolve whenever `c` happens to be written
	// before `b` (making `b`'s hop happen in phase 1 instead of phase 2),
	// even though the identical reference graph must stay unresolved for
	// `a` regardless of where `c` is written (§4: "the output is
	// independent of mapping enumeration order"; Appendix 8: transitive
	// references are not supported). The phase-2 snapshot substitutes this
	// original text back in for such keys, so a key that was itself a pure
	// reference is never a valid target for another key's hop — while its
	// own resolved value (already computed) is untouched.
	const originalPureRefText: Record<string, string> = {}

	for (let i = 0; i < keyCount; i++) {
		const rawDQ = parts[i * 5 + 2]
		const key   = parts[i * 5] ?? parts[i * 5 + 1] ?? (rawDQ !== undefined ? unescapeDQ(rawDQ) : undefined)
		if (key === undefined) continue
		keyIndexByName[key] = i
		checkKeyLength(key, keyLine(i))

		// Not routed through checkDuplicateKey: keyLine(i) triggers a full
		// document scan (lazily memoized) on its first call, so it must stay
		// inside the `if` — evaluating it unconditionally on every key would
		// defeat that laziness on the common (no-duplicate) happy path.
		if (key in metadata) {
			const msg = `LIMA: duplicate key "${key}" at line ${keyLine(i)} — last value wins`
			if (strict) throw new Error(msg)
			console.warn(msg)
		}

		const sep     = parts[i * 5 + 3]
		const raw     = parts[i * 5 + 4] ?? ''
		const isBlock = sep.charCodeAt(sep.length - 1) === 10 // '\n'

		// Split lines in one pass, skipping empty entries (replaces split+filter(Boolean))
		const lines: string[] = []
		let lineStart = 0
		for (let j = 0; j <= raw.length; j++) {
			if (j === raw.length || raw.charCodeAt(j) === 10 /* '\n' */) {
				if (j > lineStart) lines.push(raw.slice(lineStart, j))
				lineStart = j + 1
			}
		}

		if (isBlock) {
			// ── Block value: Array or Map ─────────────────────────────────────
			// Find the first non-empty line to determine the indentation level
			let firstNonEmpty = 0
			while (firstNonEmpty < lines.length && !lines[firstNonEmpty].trim()) firstNonEmpty++
			const baseIndent = firstNonEmpty < lines.length ? leadingSpaces(lines[firstNonEmpty]) : 0
			// keyLine(i) is needed unconditionally now (not just in strict
			// mode): non-strict duplicate-key warnings inside a block value
			// need an accurate line number too, not just strict-mode throws.
			metadata[key] = parseBlock(lines, 0, baseIndent, metadata, partials, strict, keyLine(i) + 1).value

		} else {
			// ── Inline value: String (single- or multi-line) ──────────────────
			if (lines.length === 0) {
				metadata[key] = null
				continue
			}

			const line0Trimmed = lines[0].trim()
			if (lines.length === 1 || (line0Trimmed !== '|' && line0Trimmed !== '>')) {
				// Single-line inline value (Core §4): only the first captured
				// line is ever the value. Any further lines here are an
				// artifact of splitting the whole document on key positions,
				// not part of this value — they are unrelated top-level
				// content and must be silently ignored (§4: "Lines that do
				// not match any key pattern ... are silently skipped"),
				// never merged in. The one exception is a `|`/`>` block-scalar
				// marker on the first line, handled by the block below.
				const line0   = lines[0]
				const val     = line0.includes('#') ? stripComment(line0) : line0
				// One-hop limit bookkeeping (see declaration above) — must be
				// recorded regardless of whether this key ends up resolving in
				// the live pass below, so it stays cheap: a single anchored
				// regex test, only reached for values shaped like `(...)`.
				if (val.charCodeAt(0) === 40 && val.charCodeAt(val.length - 1) === 41 && PURE_REF_RE.test(val)) {
					originalPureRefText[key] = val
				}
				// Line is needed unconditionally (not just in strict mode):
				// resource-limit checks and flow-mapping duplicate-key
				// warnings apply in both modes, not only strict.
				const flowSeq = parseFlowSequence(val, metadata, partials, strict, keyLine(i))
				if (flowSeq !== null) {
					metadata[key] = flowSeq
				} else {
					const flowMap = parseFlowMapping(val, metadata, partials, strict, keyLine(i))
					if (flowMap !== null) {
						metadata[key] = flowMap
					} else {
						// Line is needed unconditionally here (not just in strict mode):
						// resource-limit errors (checkScalarLimit) are hard errors in
						// both modes.
						metadata[key] = resolveValue(val, metadata, partials, strict, keyLine(i))
					}
				}
				continue
			}

			// Multi-line string.
			// Block scalar markers (must appear alone on the first line):
			//   |  — literal block: preserves newlines (YAML block scalar)
			//   >  — folded block: newlines become spaces, blank lines become \n
			//        (YAML-compatible alias; equivalent to applying ^^ on every line)
			// ^^ at the end of a line merges it with the next (LIMA-specific sugar).
			const isPipeBlock   = lines[0].trim() === '|'
			const isFoldedBlock = !isPipeBlock && lines[0].trim() === '>'

			// Content lines are re-split directly from `raw` rather than reused
			// from the `lines` array above: that array was built by skipping
			// every blank raw line, which is correct for map/array block bodies
			// but would silently drop internal blank lines that §6.1.5 requires
			// to be preserved as empty strings in the joined block-scalar result.
			const bodyLines = raw.slice(raw.indexOf('\n') + 1).split('\n')

			// Pass 1: find the minimum indentation across non-empty content
			// lines. Empty lines do not participate (§6.1.5). The result
			// (minIndent) is capped at key.length + 2 (key + ": ") to avoid
			// over-trimming when content is aligned past the key column.
			let minIndent = Infinity
			for (const bodyLine of bodyLines) {
				if (!bodyLine.trim()) continue
				const indent = bodyLine.length - bodyLine.trimStart().length
				if (indent < minIndent) minIndent = indent
			}
			minIndent = Math.min(minIndent, key.length + 2)
			const trimAmt = minIndent > 1 && isFinite(minIndent) ? minIndent : 0

			// Pass 2: trim indentation + merge ^^ continuation lines.
			// Folded into one loop — no intermediate array needed.
			// Core §6.1.6: within a `|` block, a line *beginning* with `^^`
			// (after indentation trimming) is a continuation line, appended to
			// the previous line with a single space; the marker is removed.
			// `^^` has no special meaning outside `|` blocks (isPipeBlock).
			// If ^^ appears on the very first line (mergedLines is empty), the
			// marker is stripped and the content is kept to avoid data loss.
			const mergedLines: string[] = []
			for (const bodyLine of bodyLines) {
				const dedented = trimAmt > 0 ? bodyLine.slice(trimAmt) : bodyLine
				const isContinuation = isPipeBlock && dedented.startsWith('^^')
				const content = (isContinuation ? dedented.slice(2) : dedented).trimEnd()
				if (isContinuation) {
					if (mergedLines.length > 0) {
						// Guard: bare `^^` line (empty content) is dropped silently.
						// Without this, `' ' + ''` would leave a trailing space on the previous line.
						if (content) mergedLines[mergedLines.length - 1] += ' ' + content
					} else {
						mergedLines.push(content)
					}
				} else {
					mergedLines.push(content)
				}
			}

			// §6.1.5: trailing empty lines/newlines at the end of the scalar are
			// removed; internal blanks (preserved above) are left untouched.
			while (mergedLines.length > 0 && mergedLines[mergedLines.length - 1] === '') mergedLines.pop()

			if (isFoldedBlock) {
				// Fold: all lines joined with a single space
				metadata[key] = mergedLines.join(' ')
			} else {
				metadata[key] = mergedLines.join('\n')
			}
			checkScalarLimit(metadata[key], keyLine(i))
		}
	}

	// Second pass: resolve forward references.
	// References to keys that appear later in the document were left as plain strings
	// in the first pass (metadata was incomplete at that point). All keys are now parsed.
	// Skipped entirely when the document contains no reference syntax (the common case).
	//
	// References §4.2 / §4: this phase reads from an immutable snapshot of the
	// phase-1 output — results produced during this same phase must not become
	// resolution targets within it (the one-hop limit, §3.7). Resolving against
	// the live `metadata` object instead would let a value alias its target's
	// still-unresolved token text (e.g. a chain `a: ($b)`, `b: ($c)` would
	// incorrectly give `a` the text "($c)" instead of leaving it unresolved).
	if (hasRefs) {
		const phase1Snapshot: Meta = emptyMapping()
		for (const key of Object.keys(metadata)) {
			// A key whose inline value was itself a pure reference token uses
			// that ORIGINAL text here, not its (possibly already-resolved)
			// current value — see originalPureRefText's declaration above.
			phase1Snapshot[key] = key in originalPureRefText ? originalPureRefText[key] : metadata[key]
		}
		for (const key of Object.keys(metadata)) {
			// keyLine(...) is needed unconditionally (not just in strict mode):
			// the "always throw" reference-shape errors (mapping/nested-array
			// in interpolation, array-as-sequence-item) can first surface here,
			// in phase 2, in non-strict mode too, and §5's error-ordering
			// collection (collectedRefErrors) needs an accurate line to sort
			// by regardless of mode — line 0 would wrongly sort first.
			metadata[key] = resolveForward(
				metadata[key], phase1Snapshot, partials, strict, keyLine(keyIndexByName[key])
			)
		}
	}

	// Strict mode: collect every reference still unresolved after both passes.
	// This catches genuinely missing keys without penalising forward references.
	if (strict) {
		// Line is the defining top-level key's line — the best granularity
		// available without full per-node source-position tracking (References
		// §5 asks for the token's source line; this parser does not retain
		// positions past the key level for values nested in blocks/arrays).
		// Collected rather than thrown on the first match (§5 error ordering —
		// see collectedRefErrors): every unresolved token across the whole
		// document must be a candidate before the earliest one is picked.
		const scanUnresolved = (val: any, line: number): void => {
			if (isInactiveValue(val)) return // quoted at parse time — literal, not unresolved (§2.3)
			if (typeof val === 'string' && (val.includes('($') || val.includes('(%'))) {
				const m = val.match(/\(([%$])([^)]+)\)/)
				if (m) collectedRefErrors.push({ line, message: `LIMA: unresolved reference "(${m[1]}${m[2]})" at line ${line}` })
			} else if (Array.isArray(val)) {
				for (const v of val) scanUnresolved(v, line)
			} else if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
				for (const v of Object.values(val)) scanUnresolved(v, line)
			}
		}
		for (const key of Object.keys(metadata)) {
			scanUnresolved(metadata[key], keyLine(keyIndexByName[key]))
		}
	}

	// References §5: of every reference-resolution error collected above
	// (mapping-in-interpolation, invalid array elements, and — strict mode
	// only — unresolved references), the one at the lowest source line is
	// thrown; the rest are discarded. Ties (same line) keep collection order,
	// since Array#sort is stable and this parser tracks line-level position
	// only (§5's character-offset tie-breaker is not currently retained).
	if (collectedRefErrors.length > 0) {
		collectedRefErrors.sort((a, b) => a.line - b.line)
		throw new Error(collectedRefErrors[0].message)
	}

	// Core §9: nesting depth of the final tree, both modes. The document
	// root mapping does not count as a level (depth is computed over its
	// values, not the root itself). Global resource errors without a more
	// specific attributable token report line 1 (References §5 fallback).
	const depth = Object.values(metadata).length === 0
		? 0
		: Math.max(...Object.values(metadata).map(computeDepth))
	if (depth > NESTING_DEPTH_LIMIT) {
		throw new Error(`LIMA: nesting depth exceeds maximum of ${NESTING_DEPTH_LIMIT} at line 1`)
	}

	// References §6.2: total node count of the final result tree, both
	// modes — prevents unbounded growth through repeated deep copies of a
	// large partial (e.g. 128 keys each referencing the same 4,096-node
	// partial). The root mapping counts as one node itself, unlike the
	// depth check above (Core §9 explicitly excludes the root from depth;
	// no equivalent exclusion is stated for node count).
	const totalResultNodes = countValueNodes(metadata)
	if (totalResultNodes > RESULT_NODE_LIMIT) {
		throw new Error(`LIMA: result exceeds maximum size of ${RESULT_NODE_LIMIT} total nodes at line 1`)
	}

	// No inactive-value marker (§2.3) may reach the public API — replace
	// every one, at any nesting depth, with its plain string.
	for (const key of Object.keys(metadata)) metadata[key] = unwrapInactive(metadata[key])

	return metadata as unknown as T
}

export { parse }
export type { ParseOptions }
