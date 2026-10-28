/**
 * Differential test: the same random documents through the TypeScript, Rust and Go implementations of Lima Core, in
 * both modes, compared on value, warning lines, and error code and line. The corpus pins what someone thought of; this
 * finds where the three read an unforeseen input differently — each such input is either an implementation defect or a
 * place the specification leaves open.
 *
 * The Rust and Go sides are small probes over the public Core API (`rust/examples/differential.rs`,
 * `go/internal/differential`): a JSON array of documents on stdin, two outcomes per document on stdout.
 *
 *   bun src/differential.ts --rust <probe> --go <probe> [--seeds 1,2,3] [--docs 25000] [--show 10]
 *
 * Seeds make every run reproducible; `--seeds random` picks one and prints it. Exits 1 on any disagreement, printing
 * each with its input shrunk to the lines the disagreement needs.
 */
import { spawnSync } from 'node:child_process'
import { parseCore } from '../../../js/src/index'
import { LimaError } from '../../../js/src/errors'

export type Outcome =
	| { value: unknown; warnings: number[] }
	| { error: string; line: number | null }
	| { crash: string }

export type Rng = () => number

/** A seeded generator (mulberry32): the same seed gives the same documents on every machine. */
export const seededRng = (seed: number): Rng => {
	let state = seed | 0
	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const below = (rng: Rng, n: number): number => Math.floor(rng() * n)
const pick = <T>(rng: Rng, items: readonly T[]): T => items[below(rng, items.length)]!
const chance = (rng: Rng, p: number): boolean => rng() < p
const pad = (n: number): string => ' '.repeat(n)

const KEYS = ['a', 'b', 'c', 'title', 'tags', 'x_1', 'k-2', 'a:b', '9', '"quoted key"', "'single key'", '"esc\\tkey"', '"$int"', '"$map"']

/** Inline values: every scalar type and its edges, quoting and escapes, flow collections, and YAML-only syntax. */
const VALUES = [
	'hello', 'Hello World', 'a: b', 'x:y', 'C:\\path', 'https://example.com/a#b', 'café ✓', 'tab\tinside',
	'mixed\u00a0nbsp', '42', '-7', '0', '007', '1_000', '+5', '3.14', '-0.0', '.5', '5.', '1e3', '1.5e-3', '1e400',
	'1e-400', '0x1F', '9007199254740993', '-9223372036854775809', 'true', 'false', 'True', 'yes', 'null', '~', 'NULL',
	'', '2026-10-28', '2026-02-29', '2024-02-29', '2026-13-01', '0000-01-01', '9999-12-31', '2026-10-28T14:30:00Z',
	'2026-10-28T14:30:00+02:00', '2026-10-28T14:30:00+15:00', '2026-10-28T14:30', '2026-10-28 14:30:00',
	'2026-10-28T14:30:00.123Z', '28.10.2026', '28.10.2026 14:30', '1.2.2026', '28/10/2026', '10/28/2026', '"quoted"',
	'"with # hash"', '"esc \\n \\t \\u00e9 \\x41 \\\\"', '"bad \\q"', '"short \\u12"', '"unterminated', '"a" trailing',
	"'single'", "'it\\'s'", "'unterminated", 'text # comment', 'text#nocomment', '"q" # c', '# only comment', '[]',
	'[a, b, c]', '[1, "two", 3.5, true, null]', '[{x: 1}, {y: 2}]', '[a, , b]', '[a, b,]', '[, a]', '[[1]]',
	'[{a: [1]}]', '[a', '[a, "b]', '{}', '{a: 1, b: two}', '{a: [x]}', '{a: {b: 1}}', '{a 1}', '{a: 1', '{a: 1,}',
	'${ref}', '$(partial)', '($old)', 'line ^^', '>', '>-', '|-', '|+', '| # c', '&anchor', '*alias', '!!str x',
]

/** Lines that belong to no structure, or only to some: what strict mode must reject and non-strict mode skip. */
const NOISE = ['', '   ', '# comment', 'freetext', 'a.b: 1', 'bad key: 1', '---', '...', '- stray', 'key:value', '^^ more',
	'\u00a0', '\u00a0# note', '\u00a0x: 1', '\u3000- y']

/** Whole lines for the soup half, which puts structure in random order rather than nesting it. */
const ATOMS = [
	'k1: v', 'k2: 1', 'k3:', 'k4: |', 'k5: >', '- a', '- k6: x', '- k7:', '-', '---', 'a.b: v', 'a b: v', 'text', '# c',
	'', 'k8: [a, b]', 'k9: "q"', 'x: y', '- - z', '^^ cont', 'k10: |-', '"q k": v', '...', 'k11:value', '  ', '\tk12: v',
	'k13: v\r', '\u00a0k14: v', '  body', '    deep: 1', '- [a, b]', '- {a: 1}', 'k15: {a: 1}', '\u00a0', '\t- t',
	'k16: | # c', '"open: v', '  k17: w', '    k18: w', '-\ta', '- 2026-10-28', 'k19: 1e400',
]

const inlineEntry = (rng: Rng, indent: number, key: string): string =>
	pad(indent) + key + ':' + pad(chance(rng, 0.1) ? 3 : 1) + pick(rng, VALUES) + (chance(rng, 0.1) ? ' # note' : '')

function entry(rng: Rng, indent: number, depth: number, lines: string[]): void {
	const key = pick(rng, KEYS)
	const r = rng()
	if (r < 0.45 || depth >= 3) {
		lines.push(inlineEntry(rng, indent, key))
	} else if (r < 0.6) {
		lines.push(pad(indent) + key + ':')
		const child = indent + 1 + below(rng, 4)
		for (let n = 1 + below(rng, 3); n > 0; n--) entry(rng, child, depth + 1, lines)
	} else if (r < 0.75) {
		lines.push(pad(indent) + key + ':')
		// a compact sequence (Core 1.1 §7.2) at the key's own column, or a deeper one
		sequence(rng, chance(rng, 0.35) ? indent : indent + 1 + below(rng, 3), depth + 1, lines)
	} else if (r < 0.85) {
		lines.push(pad(indent) + key + ': |')
		const body = indent + 1 + below(rng, 3)
		for (let n = below(rng, 4); n > 0; n--) {
			lines.push(chance(rng, 0.15) ? '' : pad(body + below(rng, 2)) + pick(rng, [...VALUES, '# kept', 'more ^^']))
		}
	} else {
		lines.push(pad(indent) + key + ':')
	}
}

function sequence(rng: Rng, indent: number, depth: number, lines: string[]): void {
	for (let n = 1 + below(rng, 4); n > 0; n--) {
		const r = rng()
		const dash = pad(indent) + (chance(rng, 0.9) ? '- ' : pick(rng, ['-\t', '-   ', '-\u00a0']))
		if (r < 0.4 || depth >= 3) {
			lines.push(dash + pick(rng, VALUES))
		} else if (r < 0.5) {
			lines.push(pad(indent) + '-')
		} else if (r < 0.75) {
			lines.push(inlineEntry(rng, 0, dash + pick(rng, KEYS)))
			for (let m = below(rng, 3); m > 0; m--) entry(rng, indent + 2, depth + 1, lines)
		} else if (r < 0.87) {
			lines.push(dash + pick(rng, KEYS) + ':')
			if (chance(rng, 0.4)) sequence(rng, indent + 2, depth + 1, lines)
			else for (let m = 1 + below(rng, 2); m > 0; m--) entry(rng, indent + 3 + below(rng, 2), depth + 1, lines)
		} else {
			lines.push(dash + '- ' + pick(rng, VALUES))
			if (chance(rng, 0.5)) lines.push(pad(indent + 2) + '- ' + pick(rng, VALUES))
		}
	}
}

/** A document nested the way front matter is, then disturbed: stray lines, shifted indentation, tabs, line ends. */
function structured(rng: Rng): string[] {
	const lines: string[] = []
	for (let n = 1 + below(rng, 5); n > 0; n--) entry(rng, 0, 0, lines)
	const out: string[] = []
	for (const line of lines) {
		if (chance(rng, 0.08)) out.push(pad(below(rng, 6)) + pick(rng, NOISE))
		let l = line
		if (chance(rng, 0.04)) l = l.startsWith(' ') && chance(rng, 0.5) ? l.slice(1) : ' ' + l
		if (chance(rng, 0.03) && l.startsWith('  ')) l = '\t' + l.slice(2)
		// indentation that ends in other whitespace, which is no indentation (Core 1.1 §7.1)
		if (chance(rng, 0.02)) l = l.replace(/^( *)/, (spaces) => spaces + pick(rng, ['\u00a0', '\ufeff', '\u2003']))
		if (chance(rng, 0.04)) l += '  '
		out.push(l)
	}
	return out
}

function soup(rng: Rng): string[] {
	const lines: string[] = []
	for (let n = 1 + below(rng, 6); n > 0; n--) lines.push(pad([0, 0, 0, 1, 2, 2, 3, 4][below(rng, 8)]!) + pick(rng, ATOMS))
	return lines
}

/**
 * A document at one of Core's resource limits (§9), just below, at or just above it: nesting depth, top-level key
 * count, key and scalar length, document size.
 */
function atLimit(rng: Rng): string[] {
	const near = (limit: number): number => limit - 1 + below(rng, 3)
	switch (below(rng, 5)) {
		case 0: {
			const depth = near(16)
			const lines = Array.from({ length: depth - 1 }, (_, i) => pad(i) + 'k' + i + ':')
			return [...lines, pad(depth - 1) + 'leaf: ' + pick(rng, ['[1]', '{a: 1}', 'x'])]
		}
		case 1:
			return Array.from({ length: near(128) }, (_, i) => 'k' + below(rng, i + 1) + ': ' + i)
		case 2:
			return ['k' + 'x'.repeat(near(128) - 1) + ': v']
		case 3:
			return ['v: ' + pick(rng, ['', '"']) + 'x'.repeat(near(16_384))]
		default: {
			// four scalars below their limit; the last one sized to put the document at 65,535 to 65,537 bytes
			const lines = Array.from({ length: 3 }, (_, i) => 'k' + i + ': ' + 'x'.repeat(16_000))
			const used = lines.reduce((n, l) => n + l.length + 1, 0) + 'k3: '.length
			return [...lines, 'k3: ' + 'x'.repeat(near(65_536) - used)]
		}
	}
}

/**
 * One random document: nested like front matter or random lines, about half each, and rarely one at a resource limit;
 * mostly `\n` line ends and a final one.
 */
export function generateDocument(rng: Rng): string {
	if (chance(rng, 0.004)) return atLimit(rng).join('\n')
	const lines = chance(rng, 0.5) ? structured(rng) : soup(rng)
	const end = chance(rng, 0.1) ? '\r\n' : chance(rng, 0.02) ? '\r' : '\n'
	return lines.join(end) + (chance(rng, 0.8) ? end : '')
}

/**
 * The probes' value form, which keeps every type apart: `{"$map": …}`, `{"$date": "YYYY-MM-DDTHH:MM:SSZ"}`,
 * `{"$int": "…"}` and `{"$float": …}` beside plain strings, booleans, null and arrays. TypeScript has one number type,
 * so its numbers are `{"$number": …}`, and the comparison with it reads `$int` and `$float` as that.
 */
const encode = (v: unknown): unknown =>
	v instanceof Date ? { $date: v.toISOString().replace('.000Z', 'Z') }
		: typeof v === 'number' ? { $number: v }
			: Array.isArray(v) ? v.map(encode)
				: v !== null && typeof v === 'object'
					? { $map: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) }
					: v

export function typescriptOutcomes(document: string): Outcome[] {
	return [false, true].map((strict): Outcome => {
		const warnings: number[] = []
		try {
			const value = parseCore(document, { strict, onWarning: (d) => { warnings.push(d.line) } })
			return { value: encode(value), warnings }
		} catch (e) {
			if (e instanceof LimaError) return { error: e.code, line: e.line ?? null }
			return { crash: String(e) }
		}
	})
}

/**
 * Runs a probe over `documents`, two outcomes each. A probe that crashes is run again on halves until the crash is
 * pinned to its document, which then counts as a disagreement of its own.
 */
export function probeOutcomes(probe: string, documents: string[]): Outcome[] {
	if (documents.length === 0) return []
	const run = spawnSync(probe, { input: JSON.stringify(documents), maxBuffer: 1 << 30, timeout: 600_000 })
	if (run.status === 0) return JSON.parse(run.stdout.toString()) as Outcome[]
	if (documents.length === 1) {
		const reason = (run.error?.message ?? run.stderr.toString().split('\n').find((l) => l.trim()) ?? `exit ${run.status}`)
		return [{ crash: reason }, { crash: reason }]
	}
	const half = documents.length >> 1
	return [...probeOutcomes(probe, documents.slice(0, half)), ...probeOutcomes(probe, documents.slice(half))]
}

/** A number as text, `-0` kept apart from `0`. */
const numberText = (n: number): string => Object.is(n, -0) ? '-0' : String(n)

/**
 * A value in its comparable form: mapping members sorted, since member order is not significant (§1), and numbers as
 * text, typed or as one `$number`. A tag is an object with exactly one key, the tag; a mapping's members are inside its
 * `$map`, so a key named like a tag is never read as one. Anything else no probe writes, and it compares as it is.
 */
const normalizeValue = (v: unknown, typed: boolean): unknown => {
	if (Array.isArray(v)) return v.map((x) => normalizeValue(x, typed))
	if (v === null || typeof v !== 'object') return v
	const keys = Object.keys(v)
	const x = (v as Record<string, unknown>)[keys[0]!]
	if (keys.length === 1) {
		switch (keys[0]) {
			case '$map': {
				const m = x as Record<string, unknown>
				return { $map: Object.fromEntries(Object.keys(m).sort().map((k) => [k, normalizeValue(m[k], typed)])) }
			}
			case '$date': return v
			case '$int': return typed ? v : { $number: numberText(Number(x)) }
			case '$float': return typed ? { $float: numberText(x as number) } : { $number: numberText(x as number) }
			case '$number': return { $number: numberText(x as number) }
		}
	}
	return { $unexpected: v }
}

/** The comparable form of an outcome; `typed` keeps Rust's and Go's integers and floats apart. */
export const canonical = (o: Outcome, typed = false): string =>
	JSON.stringify('value' in o ? { value: normalizeValue(o.value, typed), warnings: o.warnings } : o)

export interface Probes { rust: string; go: string }

/**
 * Which implementation reads a document differently from the other two: `all` when no two agree, `type` when all
 * three agree on every number's value but Rust and Go not on whether it is an integer or a float.
 */
export type Odd = 'ts' | 'rust' | 'go' | 'all' | 'type'

/** One mode's disagreement: 0 non-strict, 1 strict. */
export interface Fault { mode: number; odd: Odd }

export interface Disagreement { document: string; faults: Fault[] }

/** The documents, of `documents`, on which the three implementations do not agree, with each mode's fault. */
export function disagreements(documents: string[], probes: Probes): Disagreement[] {
	const rust = probeOutcomes(probes.rust, documents)
	const go = probeOutcomes(probes.go, documents)
	const out: Disagreement[] = []
	documents.forEach((document, i) => {
		const ts = typescriptOutcomes(document)
		const faults: Fault[] = []
		for (const mode of [0, 1]) {
			const [ro, go_] = [rust[2 * i + mode]!, go[2 * i + mode]!]
			const [t, r, g] = [canonical(ts[mode]!), canonical(ro), canonical(go_)]
			if (t !== r || r !== g) faults.push({ mode, odd: r === g ? 'ts' : t === g ? 'rust' : t === r ? 'go' : 'all' })
			else if (canonical(ro, true) !== canonical(go_, true)) faults.push({ mode, odd: 'type' })
		}
		if (faults.length > 0) out.push({ document, faults })
	})
	return out
}

/**
 * Removes lines from `document` while the implementations still disagree on it the same way — the same mode, the
 * same odd one out as `fault` — so that the input shown is the one for the fault found; a few probe runs per step.
 */
export function shrink(document: string, fault: Fault, probes: Probes): string {
	let lines = document.split('\n')
	const same = (d: Disagreement) => d.faults.some((f) => f.mode === fault.mode && f.odd === fault.odd)
	for (let progress = true; progress && lines.length > 1;) {
		progress = false
		const candidates = lines.map((_, i) => [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n'))
		const still = new Set(disagreements(candidates, probes).filter(same).map((d) => d.document))
		const smaller = candidates.find((c) => still.has(c))
		if (smaller !== undefined) { lines = smaller.split('\n'); progress = true }
	}
	return lines.join('\n')
}

function report(document: string, probes: Probes): string {
	const ts = typescriptOutcomes(document)
	const [rust, go] = [probeOutcomes(probes.rust, [document]), probeOutcomes(probes.go, [document])]
	return ['non-strict', 'strict'].map((mode, m) =>
		`  ${mode}\n    ts   ${canonical(ts[m]!)}\n    rust ${canonical(rust[m]!, true)}\n    go   ${canonical(go[m]!, true)}`)
		.join('\n')
}

function main(argv: string[]): number {
	const arg = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`)
		return i === -1 ? undefined : argv[i + 1]
	}
	const rust = arg('rust'), go = arg('go')
	if (!rust || !go) {
		console.error('usage: differential.ts --rust <probe> --go <probe> [--seeds 1,2,3|random] [--docs 25000] [--show 10]')
		return 2
	}
	const probes = { rust, go }
	const seedArg = arg('seeds') ?? '1,2,3,4'
	const seeds = seedArg === 'random' ? [Math.floor(Math.random() * 2 ** 31)] : seedArg.split(',').map(Number)
	const perSeed = Number(arg('docs') ?? 25_000)
	const show = Number(arg('show') ?? 10)
	let parses = 0, total = 0
	const found = new Set<string>()
	for (const seed of seeds) {
		const rng = seededRng(seed)
		const documents: string[] = []
		for (let i = 0; i < perSeed; i++) documents.push(generateDocument(rng))
		parses += documents.length * 2
		const bad = disagreements(documents, probes)
		total += bad.length
		const odd = (o: Odd) => bad.filter((d) => d.faults[0]!.odd === o).length
		console.log(`seed ${seed}: ${documents.length} documents, ${bad.length} disagreeing (odd one out: ` +
			`ts ${odd('ts')}, rust ${odd('rust')}, go ${odd('go')}, all differ ${odd('all')}, number type ${odd('type')})`)
		for (const { document, faults } of bad) {
			if (found.size >= show) break
			found.add(shrink(document, faults[0]!, probes))
		}
	}
	for (const document of found) console.log(`\n${JSON.stringify(document)}\n${report(document, probes)}`)
	console.log(`\n${parses} parses per implementation, ` +
		`${total === 0 ? 'no disagreement' : `${total} disagreeing document(s), ${found.size} shown`}`)
	return total === 0 ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
