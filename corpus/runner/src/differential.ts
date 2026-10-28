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
import { isTrimWhitespace } from '../../../js/src/chars'
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

const KEYS = ['a', 'b', 'c', 'title', 'tags', 'x_1', 'k-2', 'a:b', '9', '"quoted key"', "'single key'", '"esc\\tkey"']

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
const NOISE = ['', '   ', '# comment', 'freetext', 'a.b: 1', 'bad key: 1', '---', '...', '- stray', 'key:value', '^^ more']

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
		const dash = pad(indent) + (chance(rng, 0.05) ? '-\t' : '- ')
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

/** One random document: half nested like front matter, half random lines; mostly `\n` line ends and a final one. */
export function generateDocument(rng: Rng): string {
	const lines = chance(rng, 0.5) ? structured(rng) : soup(rng)
	const end = chance(rng, 0.1) ? '\r\n' : chance(rng, 0.02) ? '\r' : '\n'
	return lines.join(end) + (chance(rng, 0.8) ? end : '')
}

/**
 * Known and open, so left out rather than reported every run: content indented by Unicode whitespace other than space
 * and tab, such as U+00A0, which §3 does not define and the implementations read differently (docs/follow-ups.md).
 */
export const isKnownOpen = (document: string): boolean =>
	document.split(/\r\n|\r|\n/).some((line) => {
		const i = line.search(/[^ \t]/)
		if (i === -1 || !isTrimWhitespace(line.charCodeAt(i))) return false
		let j = i
		while (j < line.length && isTrimWhitespace(line.charCodeAt(j))) j++
		return j < line.length
	})

/** A value as the probes write it: plain JSON, a date as `{"$date": "YYYY-MM-DDTHH:MM:SSZ"}`. */
const encode = (v: unknown): unknown =>
	v instanceof Date ? { $date: v.toISOString().replace('.000Z', 'Z') }
		: Array.isArray(v) ? v.map(encode)
			: v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
				: v

export function typescriptOutcomes(document: string): Outcome[] {
	return [false, true].map((strict): Outcome => {
		const warnings: number[] = []
		try {
			const value = parseCore(document, { strict, onWarning: (d) => { warnings.push(d.line) } })
			return { value: JSON.parse(JSON.stringify(encode(value))), warnings }
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
	if (run.status === 0) {
		return (JSON.parse(run.stdout.toString()) as Outcome[]).map((o) =>
			'line' in o ? { error: o.error, line: o.line || null } : o)
	}
	if (documents.length === 1) {
		const reason = (run.error?.message ?? run.stderr.toString().split('\n').find((l) => l.trim()) ?? `exit ${run.status}`)
		return [{ crash: reason }, { crash: reason }]
	}
	const half = documents.length >> 1
	return [...probeOutcomes(probe, documents.slice(0, half)), ...probeOutcomes(probe, documents.slice(half))]
}

const sortKeys = (v: unknown): unknown =>
	Array.isArray(v) ? v.map(sortKeys)
		: v !== null && typeof v === 'object'
			? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
			: v

/** The comparable form of an outcome: keys sorted, since member order is not significant (§1). */
export const canonical = (o: Outcome): string => JSON.stringify(sortKeys(o))

export interface Probes { rust: string; go: string }

/** Which implementation reads a document differently from the other two, or `all` when no two agree. */
export type Odd = 'ts' | 'rust' | 'go' | 'all'

export interface Disagreement { document: string; odd: Odd }

/** The documents, of `documents`, on which the three implementations do not agree in either mode. */
export function disagreements(documents: string[], probes: Probes): Disagreement[] {
	const rust = probeOutcomes(probes.rust, documents)
	const go = probeOutcomes(probes.go, documents)
	const out: Disagreement[] = []
	documents.forEach((document, i) => {
		const ts = typescriptOutcomes(document)
		for (const m of [0, 1]) {
			const [t, r, g] = [canonical(ts[m]!), canonical(rust[2 * i + m]!), canonical(go[2 * i + m]!)]
			if (t === r && r === g) continue
			out.push({ document, odd: r === g ? 'ts' : t === g ? 'rust' : t === r ? 'go' : 'all' })
			return
		}
	})
	return out
}

/** Removes lines from `document` while the implementations still disagree on it; a few probe runs per step. */
export function shrink(document: string, probes: Probes): string {
	let lines = document.split('\n')
	for (let progress = true; progress && lines.length > 1;) {
		progress = false
		const candidates = lines.map((_, i) => [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n'))
		const still = new Set(disagreements(candidates, probes).map((d) => d.document))
		const smaller = candidates.find((c) => still.has(c))
		if (smaller !== undefined) { lines = smaller.split('\n'); progress = true }
	}
	return lines.join('\n')
}

function report(document: string, probes: Probes): string {
	const ts = typescriptOutcomes(document)
	const [rust, go] = [probeOutcomes(probes.rust, [document]), probeOutcomes(probes.go, [document])]
	return ['non-strict', 'strict'].map((mode, m) =>
		`  ${mode}\n    ts   ${canonical(ts[m]!)}\n    rust ${canonical(rust[m]!)}\n    go   ${canonical(go[m]!)}`).join('\n')
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
	let parses = 0, skipped = 0, total = 0
	const found = new Set<string>()
	for (const seed of seeds) {
		const rng = seededRng(seed)
		const documents: string[] = []
		for (let i = 0; i < perSeed; i++) {
			const document = generateDocument(rng)
			if (isKnownOpen(document)) skipped++
			else documents.push(document)
		}
		parses += documents.length * 2
		const bad = disagreements(documents, probes)
		total += bad.length
		const odd = (o: Odd) => bad.filter((d) => d.odd === o).length
		console.log(`seed ${seed}: ${documents.length} documents, ${bad.length} disagreeing ` +
			`(odd one out: ts ${odd('ts')}, rust ${odd('rust')}, go ${odd('go')}, all differ ${odd('all')})`)
		for (const { document } of bad) {
			if (found.size >= show) break
			found.add(shrink(document, probes))
		}
	}
	for (const document of found) console.log(`\n${JSON.stringify(document)}\n${report(document, probes)}`)
	console.log(`\n${parses} parses per implementation, ${skipped} documents left out as known open, ` +
		`${total === 0 ? 'no disagreement' : `${total} disagreeing document(s), ${found.size} shown`}`)
	return total === 0 ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
