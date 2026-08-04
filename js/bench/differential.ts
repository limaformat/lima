/**
 * Differential fuzzing: compares `parseCore`'s observable behavior (result,
 * warnings, and thrown-error shape, in both strict and non-strict mode)
 * between this checkout and another one given on the command line — e.g. a
 * candidate clone under independent review, the way the two 2026-08
 * performance rounds (see `REVIEW-CODEX_CLI.md` and the commit history
 * around `04af3f4`/`cea88ec`) used an ad hoc `/tmp` script for the same
 * purpose. Not part of `bun test` and not a CI gate for the same reason
 * `vs-yaml.ts` isn't — it needs a second checkout to compare against, so
 * there's nothing meaningful to run it against by default.
 *
 * This exists because two real bugs (round 1: a block-sequence dash prefix
 * with 2+ whitespace characters; round 2: an ASCII-only indentation scan
 * silently dropping content indented with non-breaking space) passed the
 * full 250-case normative corpus and the full unit-test suite while
 * present, and were only caught by generating adversarial inputs and diffing
 * actual output against a known-good baseline. The generated case set below
 * targets exactly the two surfaces those bugs came from — scalar
 * classification's first-character handling, and whitespace/indentation
 * handling — plus the number/date grammar and full-Unicode leading
 * characters more broadly. Extend it with the next surface a future
 * optimization touches, the same way it grew from round 1 (7102 cases) to
 * round 2 (7546 cases).
 *
 * Usage (from `js/`, an absolute path — dynamic `import()` resolves a
 * relative one against this file's own location, i.e. `bench/`, not the
 * current working directory):
 *   bun run bench/differential.ts /absolute/path/to/other-checkout/js/src/index.ts
 */

const otherPath = Bun.argv[2]
if (!otherPath) {
	console.error('Usage: bun run bench/differential.ts /absolute/path/to/other-checkout/js/src/index.ts')
	process.exit(1)
}

const { parseCore: thisImpl } = await import('../src/index.ts')
const { parseCore: otherImpl }: { parseCore: typeof thisImpl } = await import(otherPath)

const docs: string[] = [
	'values:\n  -  value\n  -   \'quoted\'\n  -  [1, 2]\n  -  {a: 1}\n',
	'a:\n  b: 1\n\u00a0\u00a0c: 2\n',
	'a:\n  b: 1\n\u00a0\u00a0\n  c: 2\n',
	// Every branch that follows the canonical block-object continuation
	// path: ordinary value, quoted key, nested key, comment, blank line,
	// invalid continuation and the next sibling object.
	'items:\n  - name: A\n    email: a@example.com\n',
	'items:\n  - name: A\n    "quoted key": value\n',
	'items:\n  - name: A\n    nested:\n      value: 1\n',
	'items:\n  - name: A\n    # comment\n    email: a@example.com\n',
	'items:\n  - name: A\n\n    email: a@example.com\n',
	// Claude Code round-4 additions: three more shapes the continuation
	// loop's break conditions should hand back to the slow path for, not
	// found in Codex's own 7-case list — an empty unquoted key (Core §5.2
	// explicitly allows '': as a valid key, but the loop's
	// `!continuationKey` check bails on it rather than trying to replicate
	// stripKeyQuotes/checkDuplicateKey-equivalent handling inline), a
	// continuation line itself starting with '-' (not excluded by the
	// quote/comment first-character check, relies on indexOf(': ') finding
	// the same split point findKeySep would), and three consecutive
	// continuation lines (single-iteration cases above can't show the loop
	// itself iterating correctly, only firing once).
	'items:\n  - name: A\n    : empty-key-value\n    email: a@example.com\n',
	'items:\n  - name: A\n    - nested: dash-value\n',
	'items:\n  - name: A\n    email: a@example.com\n    role: admin\n',
	'items:\n  - name: A\n    invalid continuation\n',
	'items:\n  - name: A\n  - name: B\n',
]

// Claude Code round-3 addition: a block-sequence item that's itself a bare
// "key:" marker (no inline value), with its value nested on following
// lines — e.g. `- author:\n    name: Alice`. Found missing from every
// existing sweep below (the dash-item × scalarBodies sweep only ever
// produces self-contained single-line values, never a colon-terminated key
// needing a lookahead) while reviewing a round-3 candidate whose new
// block-sequence fast path skipped exactly this case, discarding the
// nested mapping entirely (`{"items":["author:"]}` instead of
// `{"items":[{"author":{"name":"Alice"}}]}`) — 16,026/16,026 differential
// cases passed at the time, including Codex's own round-3 extension,
// because none of them exercised this shape.
docs.push(
	'items:\n  - author:\n      name: Alice\n',
	'items:\n  - author:\n      name: Alice\n  - author:\n      name: Bob\n',
	'items:\n  - a:\n      b:\n        c: 1\n',
	'items:\n  - key:\n  - next: 1\n',
	'items:\n  - key:\nafter: 1\n',
)

// Sweeps every possible leading byte (0-127) against a fixed set of value
// bodies — targets any fast path that branches on a scalar's first
// character (e.g. "only digit/'-'/'.' can start a number or date").
const scalarPrefixes = ['', ...Array.from({ length: 128 }, (_, i) => String.fromCharCode(i))]
const scalarBodies = [
	'word', '123', '1.25', '-3', '.5', 'true', 'false', 'null', '~',
	'2024-03-01', '01.02.2024', '2024/03/01 12:30:00', 'a@b.example',
	'[1, 2]', '{a: 1}', 'Infinity', '+1', '0x10', '($ref)', 'https://x/y',
]
for (const prefix of scalarPrefixes) {
	for (const body of scalarBodies) {
		docs.push(`key: ${prefix}${body}\n`)
		docs.push(`items:\n  - ${prefix}${body}\n`)
	}
}

// The ASCII-only prefix sweep above stresses toType's first-character gate
// against 129 possible leading bytes, but every body there is either
// already-invalid-as-a-number garbage or a short literal — it never
// exercises the interior number/date grammar (exponents, overflow/
// underflow, the safe-integer boundary, full ISO datetime forms), true
// non-ASCII Unicode as the *leading* character (charCodeAt(0) > 127 is
// entirely untested by the 0-127 prefix sweep), or the (%key) partial-
// reference form alongside ($key).
const numberAndDateBodies = [
	// Exponent forms, all three date-grammar-adjacent but numeric shapes.
	'1e10', '1E10', '1e+10', '1e-10', '1.5e3', '1.5E-3', '-1e10', '.5e2',
	// Float overflow (exponent large enough that Number() yields Infinity).
	'1e400', '-1e400', '1.7976931348623157e309',
	// Non-zero float underflow to zero (subnormal-adjacent boundary).
	'1e-400', '5e-324', '1e-320',
	// Safe-integer boundary, both sides, both signs.
	'9007199254740991', '9007199254740992', '9007199254740993',
	'-9007199254740991', '-9007199254740992', '-9007199254740993',
	// Subnormal (should remain a normal float, not underflow).
	'5e-320',
	// Leading zeros / trailing dot / explicit plus — explicitly-not-number forms.
	'007', '1.', '+42', '-0', '-0.0',
	// Full ISO datetime forms: Z, positive/negative offset, boundary offset, seconds.
	'2024-03-01T09:00:00Z', '2024-03-01T09:00Z', '2024-03-01T09:00:00+14:00',
	'2024-03-01T09:00:00-14:00', '2024-03-01T09:00:00+14:01', '0001-01-01T00:00+14:00',
	'9999-12-31T23:59-14:00',
	// Invalid calendar dates (component validation, strict-sensitive).
	'2023-02-29', '2024-02-30', '2024-04-31',
	// German/slash forms with seconds.
	'1.2.2024 09:00:00', '2024/03/01 09:00:00',
	// Reference-shaped text, both sigils (Core never resolves either).
	'(%partial)', '($doc.path)',
]
for (const prefix of ['', '-', '.']) {
	for (const body of numberAndDateBodies) docs.push(`key: ${prefix}${body}\n`)
}

// Exact YYYY-MM-DD fast-path boundaries, including structurally matching
// invalid dates and non-digits that must fall back to an ordinary string.
for (const year of ['0000', '0001', '1900', '2000', '2023', '2024', '9999']) {
	for (let month = 0; month <= 13; month++) {
		for (const day of [0, 1, 28, 29, 30, 31, 32]) {
			docs.push(`date: ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}\n`)
		}
	}
}
for (const value of ['x024-01-01', '2x24-01-01', '2024-x1-01', '2024-0x-01', '2024-01-x1', '2024-01-0x']) {
	docs.push(`date: ${value}\n`)
}

// Exact 20-code-unit RFC 3339 Z fast path: component boundaries plus every
// digit position replaced by a non-digit. Structural mismatches must fall
// back to the complete date grammar; structurally valid but out-of-range
// components retain its strict/non-strict invalid-date behavior.
for (const year of ['0000', '0001', '1900', '2000', '2023', '2024', '9999']) {
	for (const month of ['00', '01', '02', '12', '13']) {
		for (const day of ['00', '01', '28', '29', '31', '32']) {
			for (const time of ['00:00:00', '23:59:59', '24:00:00', '00:60:00', '00:00:60']) {
				docs.push(`date: ${year}-${month}-${day}T${time}Z\n`)
			}
		}
	}
}
for (const position of [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]) {
	const chars = [...'2024-03-01T09:00:00Z']
	chars[position] = 'x'
	docs.push(`date: ${chars.join('')}\n`)
}

// True Unicode leading characters (charCodeAt(0) > 127) — the ASCII-only
// prefix sweep above cannot exercise this at all. Mix of BMP scripts,
// combining marks, RTL marks, zero-width characters, and one astral
// character via its UTF-16 high surrogate (charCodeAt(0) lands in the
// D800-DBFF range for those, still unconditionally non-digit/dash/dot).
const unicodeLeaders = [
	'Ж', 'Ω', '中', '文', 'ア', 'א', 'ن', '🎉', '👍🏽', '​', '‎',
	'́', 'é', 'ü', '﻿', ' ', ' ',
]
for (const leader of unicodeLeaders) {
	for (const body of ['', '123', 'word', '.5', '-3', 'e10']) {
		docs.push(`key: ${leader}${body}\n`)
	}
}

// Every ECMAScript WhiteSpace/LineTerminator code point paired with every
// other one, both as leading-key indentation and as the run after a block
// dash — targets any hand-rolled substitute for `String.prototype.trimStart()`
// or `/^-\s+/`.
const whitespace = [
	0x000b, 0x000c, 0x0020, 0x00a0, 0x1680,
	0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
	0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
	0x205f, 0x3000, 0xfeff,
].map((codePoint) => String.fromCodePoint(codePoint))
for (const a of whitespace) {
	for (const b of whitespace) {
		docs.push(`root:\n${a}${b}key: value\n`)
		docs.push(`items:\n  -${a}${b}{key: value}\n`)
		// Block key/value trimming uses the same full whitespace set at both
		// slice boundaries; cover mixed leading/trailing combinations.
		docs.push(`root:\n  ${a}key${b}: ${a}value${b}\n`)
		docs.push(`items:\n  - key${a}${b}: ${b}value${a}\n`)
	}
}

// Position-cursor research round: canonical block shapes plus the exact
// boundaries that must force a fallback to the complete grammar. Generate
// enough combinations to exercise every cursor state repeatedly instead of
// relying on the six performance documents alone.
const cursorValues = [
	'word', 'two words', '0', '-1', '.5', 'true', 'false', 'null', '~',
	'2024-03-01', 'a@example.com', 'https://example.com/path', '($ref)',
]
for (let i = 0; i < 512; i++) {
	const a = cursorValues[i % cursorValues.length]
	const b = cursorValues[(i * 7 + 3) % cursorValues.length]
	docs.push(`root:\n  key${i}: ${a}\n  other${i}: ${b}\n`)
	docs.push(`items:\n  - ${a}\n  - ${b}\n`)
	docs.push(`items:\n  - name: ${a}\n    value: ${b}\n`)
	docs.push(`root:\n  nested${i}:\n    leaf: ${a}\n`)
}

for (const suffix of [' # comment', '\u00a0', '\u2003', '\ufeff']) {
	docs.push(`root:\n  key: value${suffix}\n`)
	docs.push(`items:\n  - value${suffix}\n`)
	docs.push(`items:\n  - key: value${suffix}\n`)
	docs.push(`items:\n  - key: value\n    next: other${suffix}\n`)
}

// Discover the runtime's actual single-code-unit trimStart set over the
// complete BMP and exercise every member at cursor value boundaries. This
// validates the hand-written predicate against the primitive it replaces.
for (let code = 0; code <= 0xffff; code++) {
	const char = String.fromCharCode(code)
	if (char.trimStart() !== '') continue
	docs.push(`root:\n  key: ${char}value\n`)
	docs.push(`root:\n  key: value${char}\n`)
	docs.push(`items:\n  - ${char}value\n`)
}

// Claude Code additions (position-cursor round): the cursor's native
// hasMappingKey optimization (`entries[key] !== undefined`, relying on
// null-prototype objects having no magic __proto__ accessor) and its
// continuation-loop key extraction (asciiKey allows '-' as an ordinary
// character, same as the pre-cursor continuation loop's plain
// indexOf(': ')) both needed direct verification, not just the reasoning
// in their own code comments — differential testing across the cursor's
// several entry points (top-level, nested, array-item, continuation) for
// each.
docs.push(
	'__proto__: value\n',
	'a:\n  __proto__: value\n',
	'items:\n  - name: A\n    __proto__: value\n',
	'items:\n  - __proto__: value\n',
	'toString: value\n',
	'constructor: value\n',
	'hasOwnProperty: value\n',
	'items:\n  - name: A\n    : value\n',
	'items:\n  - name: A\n    -something: value\n',
	'items:\n  - -something: value\n',
	'a:\n  : value\n',
)

// Strict error precedence under speculative parsing: an early
// cursor-throwable value (strict-mode number overflow / invalid date /
// unclosed flow) paired with a later shape the cursor can't handle at
// all (quoted key, nested key marker), and the reverse ordering — proves
// the cursor never processes lines out of document order relative to
// the complete grammar, so whichever error a top-to-bottom scan hits
// first is unaffected by which parser (cursor or fallback) happens to
// run.
docs.push(
	'items:\n  - name: A\n    val: 1e999\n  - "quoted": B\n',
	'items:\n  - "quoted": B\n  - name: A\n    val: 1e999\n',
	'items:\n  - d: 2024-02-30\n  - a:\n      b: 1\n',
	'items:\n  - arr: [1, 2\n  - a:\n      b: 1\n',
	'items:\n  - name: A\n    email: a@x.com\n   badindent\n  - name: B\n',
	'a:\n  b:\n    c: 1\n    c: 2\n',
	'items:\n  - name: A\n  - name: "bad \\q escape"\n',
)

const observe = (parse: typeof thisImpl, doc: string, strict: boolean, captureWarnings: boolean): string => {
	const warnings: unknown[] = []
	try {
		const value = captureWarnings
			? parse(doc, { strict, onWarning: (warning) => warnings.push(warning) })
			: parse(doc, { strict })
		return JSON.stringify({ value, warnings })
	} catch (error) {
		const e = error as Error & Record<string, unknown>
		return JSON.stringify({ error: { name: e.name, message: e.message, code: e.code, line: e.line, key: e.key }, warnings })
	}
}

let checked = 0
let mismatches = 0
for (const doc of docs) {
	for (const strict of [false, true]) {
		for (const captureWarnings of [false, true]) {
			const expected = observe(thisImpl, doc, strict, captureWarnings)
			const actual = observe(otherImpl, doc, strict, captureWarnings)
			if (actual !== expected) {
				console.error(JSON.stringify({ doc, strict, captureWarnings, expected, actual }, null, 2))
				mismatches++
			}
			checked++
		}
	}
}
console.log(mismatches === 0
	? `${checked} differential cases matched`
	: `${mismatches}/${checked} differential cases MISMATCHED`)
if (mismatches > 0) process.exit(1)
