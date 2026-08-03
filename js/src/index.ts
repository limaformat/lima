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
 * Structural deep copy into a Lima-owned, prototype-free value. Pure
 * references must not alias their target — References §3.1: "The result
 * is a structural deep copy — object identity and aliasing are not part
 * of Lima semantics." Applies equally to `($key)` document references and
 * `(%key)` partial references (References §6.2: partials are deep-copied
 * into Lima-owned values, the original host objects are never used
 * directly in a result).
 */
const deepCopyLimaValue = (value: any): any => {
	if (value === null || typeof value !== 'object') return value
	if (value instanceof Date) return new Date(value.getTime())
	if (Array.isArray(value)) return value.map(deepCopyLimaValue)
	const copy = emptyMapping()
	for (const key of Object.keys(value)) copy[key] = deepCopyLimaValue(value[key])
	return copy
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
const KEY_RE = /^(?:([a-zA-Z\d_][a-zA-Z\d_:-]*)|'([^']*)'|"([^"]*)"):( *\n| )/gm

/** Used to unescape `\#` → `#` after stripping comments. */
const ESCAPED_HASH_RE = /\\#/g
/** Pure reference: entire value is exactly one ($key) or (%key). */
const PURE_REF_RE = /^\(([%$])([^)]+)\)$/
/** Inline reference occurrences for string interpolation. */
const INTERP_RE = /\(([%$])([^)]+)\)/g
/** Detects strings that might be a date (quick pre-check before Date.parse). */
const DATE_PRE_RE = /\d[\d\-:.\/a-zA-Z]{4,}/
/** Strips the leading `- ` from a block array item. */
const DASH_PREFIX_RE = /^-\s+/

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

/**
 * Normalizes a potential date string to UTC ISO 8601 and attempts to parse it.
 *
 * Strategy: when a timezone offset ([+-]HH:MM) is present, it is applied —
 * the datetime is correctly converted to UTC by Date.parse. Without an offset,
 * the time is treated as local time written by the author and stamped as UTC.
 *
 * Supported input formats:
 *   ISO 8601:        `2026-04-09`, `2026-04-09T16:00`, `2026-04-09 16:00`
 *   With offset:     `2026-04-09 16:00 +02:00`  →  14:00 UTC
 *   Slash-separated: `2026/5/21 11:00:32`
 *   German:          `10.3.2026 14:33`
 *
 * Date-only strings (no time component) are left without a Z suffix because
 * the ES spec already treats ISO date-only strings as UTC midnight.
 */
const parseDateUTC = (str: string): Date | null => {
	// Fast-path: ISO date-only YYYY-MM-DD — most common format in blog frontmatter.
	// Saves 4 regex operations; two charCode checks are enough to identify this shape.
	if (str.length === 10 && str.charCodeAt(4) === 45 /* '-' */ && str.charCodeAt(7) === 45 /* '-' */) {
		const ts = Date.parse(str)
		return !isNaN(ts) ? new Date(str) : null
	}

	// Extract timezone offset ([+-]HH:MM) if present — re-appended after normalization
	// so Date.parse applies it and converts to UTC correctly.
	const offsetMatch = str.match(/\s*([+-]\d{2}:\d{2})$/)
	const offset = offsetMatch ? offsetMatch[1] : null
	let s = offset ? str.slice(0, str.length - offsetMatch![0].length).trimEnd() : str

	// DD.MM.YYYY → YYYY-MM-DD (retains any following time)
	s = s.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/, (_, d, m, y) =>
		`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)

	// YYYY/MM/DD → YYYY-MM-DD (retains any following time)
	s = s.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, (_, y, m, d) =>
		`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)

	// Space between date and time → T separator (required for Date.parse)
	s = s.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')

	if (offset) {
		// Re-append original offset — Date.parse converts to UTC correctly
		s += offset
	} else if (s.includes('T') && !s.endsWith('Z')) {
		// No offset: stamp as UTC directly
		s += 'Z'
	}

	// Guard: only invoke Date.parse for strings that were successfully normalized
	// to ISO format. Without this, V8 accepts non-standard inputs like '1.2.3'
	// (→ 2003-01-02) or browser-locale-dependent strings, producing silent surprises.
	if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null

	const ts = Date.parse(s)
	return !isNaN(ts) ? new Date(s) : null
}

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
 * Leading decimal point (`.5`) is accepted as a number (→ 0.5) because
 * JavaScript's `Number('.5')` returns 0.5. This is not YAML 1.2 syntax but is
 * valid JSON5 and a convenient shorthand.
 *
 * All dates are normalized to UTC — see parseDateUTC for details.
 */
const toType = (str: string): string | boolean | number | Date | null => {
	try {
		if (typeof str !== 'string') return str
		if (str === '' || str === 'null' || str === '~') return null
		if (str === 'true') return true
		if (str === 'false') return false
		// Hex (0x/0X), octal (0o/0O), binary (0b/0B) — keep as strings (YAML 1.2 compatible)
		if (str.length > 2 && str.charCodeAt(0) === 48 &&
			(str.charCodeAt(1) === 120 || str.charCodeAt(1) === 88 ||
			 str.charCodeAt(1) === 111 || str.charCodeAt(1) === 79 ||
			 str.charCodeAt(1) === 98  || str.charCodeAt(1) === 66)) return str
		if (isFinite(Number(str))) return +str
		if (!str.includes('@') && DATE_PRE_RE.test(str)) {
			const date = parseDateUTC(str)
			if (date !== null) return date
		}
	} catch {}
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
const resolve = (val: string, metadata: Meta, partials: Meta): any => {
	if (!val || typeof val !== 'string') return val

	// Bare %key shorthand: entire value is %key (no parentheses needed for pure partial refs).
	// CharCode 37 = '%'. No spaces allowed — avoids false positives on values like "100% done".
	if (val.charCodeAt(0) === 37 /* '%' */ && val.length > 1 && !val.includes(' ')) {
		const resolved = partials[val.slice(1)]
		if (resolved !== undefined) return deepCopyLimaValue(resolved)
	}

	// Pure reference: entire value is exactly one ($key) or (%key).
	// CharCode pre-check avoids running the regex on values that don't start
	// with '(' (40) and end with ')' (41) — the common case for normal strings.
	const pureMatch =
		val.charCodeAt(0) === 40 /* '(' */ && val.charCodeAt(val.length - 1) === 41 /* ')' */
			? val.match(PURE_REF_RE)
			: null
	if (pureMatch) {
		const resolved = pureMatch[1] === '%' ? partials[pureMatch[2]] : getNestedValue(metadata, pureMatch[2])
		if (resolved !== undefined) return deepCopyLimaValue(resolved)
		// Unresolved — leave unchanged; strict check happens after the second pass
	}

	// String interpolation: replace all ($key) / (%key) occurrences
	if (val.includes('($') || val.includes('(%')) {
		return val.replace(INTERP_RE, (match, sigil, key) => {
			const resolved = sigil === '%' ? partials[key] : getNestedValue(metadata, key)
			if (resolved === undefined || resolved === null) return match
			if (Array.isArray(resolved)) return resolved.join(', ')
			return String(resolved)
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
const unescapeDQ = (s: string): string => {
	if (!s.includes('\\')) return s
	return s.replace(/\\(["\\\/bfnrt0]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{2})/g,
		(full, e) => {
			switch (e[0]) {
				case '"':  return '"'
				case '\\': return '\\'
				case '/':  return '/'
				case 'b':  return '\b'
				case 'f':  return '\f'
				case 'n':  return '\n'
				case 'r':  return '\r'
				case 't':  return '\t'
				case '0':  return '\0'
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
const resolveValue = (raw: string, metadata: Meta, partials: Meta): any => {
	const first = raw.charCodeAt(0)
	if ((first === 34 /* '"' */ || first === 39 /* "'" */) && raw.charCodeAt(raw.length - 1) === first) {
		const unquoted = raw.slice(1, -1)
		return first === 34 ? unescapeDQ(unquoted) : unquoted.replace(/\\'/g, "'")
	}
	return toType(resolve(raw, metadata, partials))
}

/**
 * Splits a flow-sequence body on commas that are outside quoted strings.
 * Supports both single and double quotes. Backslash-escaped quotes inside
 * strings (e.g. `\"` inside a double-quoted string) are correctly skipped.
 *
 * Examples:
 *   `a, "b, c", d`              → `['a', '"b, c"', 'd']`
 *   `"He said \"Hi\"", next`    → `['"He said \\"Hi\\"", 'next']`
 */
const splitFlowItems = (inner: string): string[] => {
	const items: string[] = []
	let start = 0
	let quote = 0 // char code of opening quote, 0 = unquoted
	for (let i = 0; i < inner.length; i++) {
		const cc = inner.charCodeAt(i)
		if (quote) {
			if (cc === 92 /* '\\' */) { i++ } // skip escaped char
			else if (cc === quote) quote = 0
		} else if (cc === 34 /* '"' */ || cc === 39 /* "'" */) {
			quote = cc
		} else if (cc === 44 /* ',' */) {
			items.push(inner.slice(start, i).trim())
			start = i + 1
		}
	}
	items.push(inner.slice(start).trim())
	return items
}

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
const parseFlowSequence = (val: string, metadata: Meta, partials: Meta): any[] | null => {
	if (val.charCodeAt(0) !== 91 /* '[' */ || val.charCodeAt(val.length - 1) !== 93 /* ']' */) return null
	const inner = val.slice(1, -1).trim()
	if (!inner) return []
	return splitFlowItems(inner).map((item) => {
		// Quoted string: strip delimiters, return as string — no type coercion.
		// Consistent with YAML: `"42"` → '42' (string), not 42 (number).
		const first = item.charCodeAt(0)
		if ((first === 34 || first === 39) && item.charCodeAt(item.length - 1) === first) {
			const unquoted = item.slice(1, -1)
			return first === 34 ? unescapeDQ(unquoted) : unquoted.replace(/\\'/g, "'")
		}
		return toType(resolve(item, metadata, partials))
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
		const colonPos = item.indexOf(': ')
		if (colonPos === -1) {
			if (strict) throw new Error(`LIMA: invalid flow mapping item (missing ": ") at line ${line}: "${item}"`)
			return null // not a valid flow mapping — fall back to string
		}
		const key    = item.slice(0, colonPos).trim()
		const rawVal = item.slice(colonPos + 2).trim()
		const first  = rawVal.charCodeAt(0)
		// Quoted string: strip delimiters and unescape, return as string — no type coercion.
		if ((first === 34 /* '"' */ || first === 39 /* "'" */) && rawVal.charCodeAt(rawVal.length - 1) === first) {
			const unquoted = rawVal.slice(1, -1)
			result[key] = first === 34 ? unescapeDQ(unquoted) : unquoted.replace(/\\'/g, "'")
		} else {
			result[key] = toType(resolve(rawVal, metadata, partials))
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
					const itemVal = trimmed.slice(colonPos + 2).trim()
					const flowSeq = parseFlowSequence(itemVal, metadata, partials)
					const flowMap = flowSeq === null ? parseFlowMapping(itemVal, metadata, partials, strict, baseLine + idx) : null
					pendingItem[itemKey] = flowSeq !== null ? flowSeq : (flowMap !== null ? flowMap : resolveValue(itemVal, metadata, partials))
					idx++
				} else if (trimmed.endsWith(':')) {
					// Nested block within an array item's continuation
					const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
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
			} else if (colonPos !== -1) {
				// Object item with inline value — may accumulate more keys via continuation lines
				const pendingKey = stripKeyQuotes(afterDash.slice(0, colonPos).trim())
				const pendingRaw = afterDash.slice(colonPos + 2).trim()
				const pendingFlowSeq = parseFlowSequence(pendingRaw, metadata, partials)
				const pendingFlowMap = pendingFlowSeq === null ? parseFlowMapping(pendingRaw, metadata, partials, strict, baseLine + idx) : null
				pendingItem = emptyMapping()
				pendingItem[pendingKey] = pendingFlowSeq !== null ? pendingFlowSeq : (pendingFlowMap !== null ? pendingFlowMap : resolveValue(pendingRaw, metadata, partials))
				idx++
			} else if (afterDash.endsWith(':')) {
				// Object item whose value is a nested block
				const itemKey = stripKeyQuotes(afterDash.slice(0, -1).trim())
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
					;(result as any[]).push(qFirst === 34 ? unescapeDQ(inner) : inner.replace(/\\'/g, "'"))
				} else {
					const resolvedVal = resolve(afterDash, metadata, partials)
					if (Array.isArray(resolvedVal)) {
						for (const item of resolvedVal) (result as any[]).push(toType(item))
					} else {
						(result as any[]).push(toType(resolvedVal))
					}
				}
				idx++
			}
		} else {
			// ── Map entry ───────────────────────────────────────────────────────
			if (!result) result = emptyMapping()
			if (Array.isArray(result)) {
				if (strict) throw new Error(`LIMA: mixed map and array entries for the same key at line ${baseLine + idx}`)
				idx++; continue
			}

			const colonPos = findKeySep(trimmed)
			if (colonPos !== -1) {
				const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim())
				const itemVal = trimmed.slice(colonPos + 2).trim()
				const flowSeq = parseFlowSequence(itemVal, metadata, partials)
				const flowMap = flowSeq === null ? parseFlowMapping(itemVal, metadata, partials, strict, baseLine + idx) : null
				;(result as Meta)[itemKey] = flowSeq !== null ? flowSeq : (flowMap !== null ? flowMap : resolveValue(itemVal, metadata, partials))
				idx++
			} else if (trimmed.endsWith(':')) {
				// Key with no inline value → check for a nested block on the next lines
				const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim())
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
				if (strict) throw new Error(`LIMA: unrecognized line at line ${baseLine + idx}: "${trimmed}"`)
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
const resolveForward = (val: any, metadata: Meta, partials: Meta): any => {
	if (typeof val === 'string' && (val.includes('($') || val.includes('(%'))) {
		return toType(resolve(val, metadata, partials))
	}
	if (Array.isArray(val)) {
		return val.map((item) => resolveForward(item, metadata, partials))
	}
	if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
		for (const k of Object.keys(val)) {
			val[k] = resolveForward(val[k], metadata, partials)
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
	if (!frontMatter) return emptyMapping() as unknown as T

	const partials = options?.partials ?? {}
	const strict   = options?.strict   ?? false

	// Normalize: CRLF → LF, tabs → 2 spaces, trailing spaces stripped per line
	frontMatter = frontMatter
		.replace(/\r\n|\t/g, (m) => (m === '\t' ? '  ' : '\n'))
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

	const metadata: Meta = emptyMapping()

	for (let i = 0; i < keyCount; i++) {
		const rawDQ = parts[i * 5 + 2]
		const key   = parts[i * 5] ?? parts[i * 5 + 1] ?? (rawDQ !== undefined ? unescapeDQ(rawDQ) : undefined)
		if (key === undefined) continue

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
			metadata[key] = parseBlock(lines, 0, baseIndent, metadata, partials, strict, strict ? keyLine(i) + 1 : 0).value

		} else {
			// ── Inline value: String (single- or multi-line) ──────────────────
			if (lines.length === 0) {
				metadata[key] = null
				continue
			}

			if (lines.length === 1) {
				// Single-line: strip comment only when '#' is present — avoids the
				// char-by-char scan and trailing replace for the common comment-free case.
				const line0   = lines[0]
				const val     = line0.includes('#') ? stripComment(line0) : line0
				const flowSeq = parseFlowSequence(val, metadata, partials)
				if (flowSeq !== null) {
					metadata[key] = flowSeq
				} else {
					const flowMap = parseFlowMapping(val, metadata, partials, strict, strict ? keyLine(i) : 0)
					metadata[key] = flowMap !== null ? flowMap : resolveValue(val, metadata, partials)
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
			const isBlockScalar = isPipeBlock || isFoldedBlock
			if (isBlockScalar) lines.shift()

			// Strip comment-only lines from continuation lines (not in block scalars
			// where '#' is literal content). Comment lines can appear between top-level
			// keys and end up as trailing lines of the preceding key's raw value after
			// KEY_RE splitting.
			if (!isBlockScalar) {
				let wi = 0
				for (let li = 0; li < lines.length; li++) {
					if (lines[li].trimStart().charCodeAt(0) !== 35) lines[wi++] = lines[li]
				}
				lines.length = wi
			}

			// Pass 1: find the minimum indentation across relevant lines.
			// For block scalars all lines count; for inline multi-line, line 0 is
			// flush against the key and not representative, so start from line 1.
			// The result (minIndent) is capped at key.length + 2 (key + ": ") to
			// avoid over-trimming when content is aligned past the key column.
			let minIndent = Infinity
			for (let li = isBlockScalar ? 0 : 1; li < lines.length; li++) {
				const line   = lines[li]
				const indent = line.length - line.trimStart().length
				if (indent < minIndent) minIndent = indent
			}
			minIndent = Math.min(minIndent, key.length + 2)
			const trimAmt = minIndent > 1 && isFinite(minIndent) ? minIndent : 0

			// Pass 2: trim indentation + merge ^^ continuation lines.
			// Folded into one loop — no intermediate array needed.
			// ^^ means: "attach me to the line above" — only valid from line 1+.
			// If ^^ appears on the very first line (mergedLines is empty), the
			// marker is ignored and the content is kept to avoid data loss.
			const mergedLines: string[] = []
			for (let li = 0; li < lines.length; li++) {
				const rtrimmed = (trimAmt > 0 && (isBlockScalar || li > 0)
					? lines[li].slice(trimAmt)
					: lines[li]
				).trimEnd()
				if (rtrimmed.endsWith('^^')) {
					const content = rtrimmed.slice(0, -2).trimEnd()
					if (mergedLines.length > 0) {
						// Guard: bare `^^` line (empty content) is dropped silently.
						// Without this, `' ' + ''` would leave a trailing space on the previous line.
						if (content) mergedLines[mergedLines.length - 1] += ' ' + content
					} else {
						mergedLines.push(content)
					}
				} else {
					mergedLines.push(rtrimmed)
				}
			}

			if (isFoldedBlock) {
				// Fold: all lines joined with a single space
				metadata[key] = mergedLines.join(' ')
			} else {
				metadata[key] = mergedLines.join('\n')
			}
		}
	}

	// Second pass: resolve forward references.
	// References to keys that appear later in the document were left as plain strings
	// in the first pass (metadata was incomplete at that point). All keys are now parsed.
	// Skipped entirely when the document contains no reference syntax (the common case).
	if (hasRefs) {
		for (const key of Object.keys(metadata)) {
			metadata[key] = resolveForward(metadata[key], metadata, partials)
		}
	}

	// Strict mode: throw if any reference is still unresolved after both passes.
	// This catches genuinely missing keys without penalising forward references.
	if (strict) {
		const scanUnresolved = (val: any): void => {
			if (typeof val === 'string' && (val.includes('($') || val.includes('(%'))) {
				const m = val.match(/\(([%$])([^)]+)\)/)
				if (m) throw new Error(`LIMA: unresolved reference "(${m[1]}${m[2]})"`)
			} else if (Array.isArray(val)) {
				for (const v of val) scanUnresolved(v)
			} else if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
				for (const v of Object.values(val)) scanUnresolved(v)
			}
		}
		for (const v of Object.values(metadata)) scanUnresolved(v)
	}

	return metadata as unknown as T
}

export { parse }
export type { ParseOptions }
