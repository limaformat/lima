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

const observe = (parse: typeof thisImpl, doc: string, strict: boolean): string => {
	const warnings: unknown[] = []
	try {
		const value = parse(doc, { strict, onWarning: (warning) => warnings.push(warning) })
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
		const expected = observe(thisImpl, doc, strict)
		const actual = observe(otherImpl, doc, strict)
		if (actual !== expected) {
			console.error(JSON.stringify({ doc, strict, expected, actual }, null, 2))
			mismatches++
		}
		checked++
	}
}
console.log(mismatches === 0
	? `${checked} differential cases matched`
	: `${mismatches}/${checked} differential cases MISMATCHED`)
if (mismatches > 0) process.exit(1)
