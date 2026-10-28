import { describe, it, expect, afterAll } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	canonical, disagreements, generateDocument, probeOutcomes, seededRng, shrink, typescriptOutcomes,
} from '../src/differential'

const documents = (seed: number, n: number): string[] => {
	const rng = seededRng(seed)
	return Array.from({ length: n }, () => generateDocument(rng))
}

// Probes that answer as TypeScript does, its numbers as integers or as floats, except that they
// crash on "boom" and read "odd" as an empty mapping: the comparison, the crash isolation and the shrinking are tested
// without the Rust and Go builds.
const dir = mkdtempSync(join(tmpdir(), 'lima-differential-'))
const probe = (name: string, number: string): string => {
	const path = join(dir, name)
	writeFileSync(path, `#!/usr/bin/env bun
import { typescriptOutcomes } from ${JSON.stringify(join(import.meta.dir, '../src/differential'))}
const documents = JSON.parse(await Bun.stdin.text())
if (documents.some((d) => d.includes('boom'))) process.exit(3)
const typed = (v) => Array.isArray(v) ? v.map(typed) : v === null || typeof v !== 'object' ? v
	: '$number' in v ? ${number} : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typed(x)]))
const empty = { value: { $map: {} }, warnings: [] }
console.log(JSON.stringify(documents.flatMap((d) => d.includes('odd') ? [empty, empty]
	: typescriptOutcomes(d).map((o) => 'value' in o ? { ...o, value: typed(o.value) } : o))))
`)
	chmodSync(path, 0o755)
	return path
}
const fake = probe('int', '{ $int: String(v.$number) }')
const floats = probe('float', '{ $float: v.$number }')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('generateDocument', () => {
	it('gives the same documents for the same seed, and others for another', () => {
		expect(documents(7, 200)).toEqual(documents(7, 200))
		expect(documents(8, 200)).not.toEqual(documents(7, 200))
	})

	it('writes the constructs the comparison is for', () => {
		const all = documents(1, 2000).join('\n')
		for (const construct of ['\n- ', ': |', '\t', '\r\n', '[', '{', '2026-10-28', '# ', '---', '\n \u00a0', '\n\u00a0']) {
			expect(all).toContain(construct)
		}
		// a compact sequence: an item at the column of the bare key before it
		expect(/(^|\n)( *)[^ \n-][^\n]*:\n\2- /.test(all)).toBe(true)
	})

	it('reaches every resource limit (§9), below, at and above it', () => {
		const errors = new Set(documents(1, 20_000).filter((d) => d.length > 1000)
			.map((d) => typescriptOutcomes(d)[0]!).map((o) => 'error' in o ? o.error : 'ok'))
		expect(errors).toEqual(new Set(['ok', 'RESOURCE_LIMIT']))
	})
})

describe('typescriptOutcomes', () => {
	it('writes both modes in the probes\' form: a date as $date, warnings by line, errors by code and line', () => {
		expect(typescriptOutcomes('d: 2026-10-28\nd: 1\n')).toEqual([
			{ value: { $map: { d: { $number: 1 } } }, warnings: [2] },
			{ error: 'DUPLICATE_KEY', line: 2 },
		])
		expect(typescriptOutcomes('d: 2026-10-28T14:30:00+02:00\n')[0])
			.toEqual({ value: { $map: { d: { $date: '2026-10-28T12:30:00Z' } } }, warnings: [] })
	})

	it('reads no key of a mapping as a tag, so a key named "$int" hides no difference', () => {
		const outcome = (x: number) => ({ value: { $map: { $int: { $int: '1' }, x: { $int: String(x) } } }, warnings: [] })
		expect(canonical(outcome(2))).not.toBe(canonical(outcome(3)))
		const [nonStrict] = typescriptOutcomes('"$int": 1\nx: 2\n')
		expect(canonical(nonStrict!)).toContain('"x"')
	})

	it('keeps a date apart from a mapping that looks like one', () => {
		const date = typescriptOutcomes('a: 2026-10-28\n')[0]!
		const mapping = typescriptOutcomes('a:\n  "$date": "2026-10-28T00:00:00Z"\n')[0]!
		expect(canonical(date)).not.toBe(canonical(mapping))
	})

	it('compares mappings regardless of member order, and numbers by value unless typed', () => {
		const ab = { value: { $map: { a: { $int: '1' }, b: { $float: 2 } } }, warnings: [] }
		const ba = { value: { $map: { b: { $float: 2 }, a: { $int: '1' } } }, warnings: [] }
		expect(canonical(ab, true)).toBe(canonical(ba, true))
		const floats = { value: { $map: { a: { $float: 1 }, b: { $float: 2 } } }, warnings: [] }
		expect(canonical(ab)).toBe(canonical(floats))
		expect(canonical(ab, true)).not.toBe(canonical(floats, true))
		expect(canonical({ value: { $float: -0 }, warnings: [] }, true)).not.toBe(canonical({ value: { $float: 0 }, warnings: [] }, true))
	})
})

describe('probes', () => {
	const probes = { rust: fake, go: fake }

	it('pins a crash to its document', () => {
		const outcomes = probeOutcomes(fake, ['a: 1\n', 'boom: 1\n', 'b: 2\n'])
		expect(outcomes).toHaveLength(6)
		const same = (probed: typeof outcomes, document: string) =>
			expect(probed.map((o) => canonical(o))).toEqual(typescriptOutcomes(document).map((o) => canonical(o)))
		same(outcomes.slice(0, 2), 'a: 1\n')
		expect(outcomes[2]).toHaveProperty('crash')
		same(outcomes.slice(4), 'b: 2\n')
	})

	it('reports the documents the implementations disagree on, shrunk to the lines that matter', () => {
		const found = disagreements(['a: 1\n', 'odd: 1\n', 'boom: 1\n'], probes)
		expect(found.map((d) => d.document)).toEqual(['odd: 1\n', 'boom: 1\n'])
		expect(found[0]!.faults).toEqual([{ mode: 0, odd: 'ts' }, { mode: 1, odd: 'ts' }])
		expect(shrink('a: 1\nb: 2\nodd: 3\nc: 4', found[0]!.faults[0]!, probes)).toBe('odd: 3')
	})

	it('reports Rust and Go disagreeing on whether a number is an integer or a float', () => {
		const found = disagreements(['a: 1\n', 'b: x\n'], { rust: fake, go: floats })
		expect(found).toEqual([{ document: 'a: 1\n', faults: [{ mode: 0, odd: 'type' }, { mode: 1, odd: 'type' }] }])
	})

	it('shrinks to the input of the fault found, not to another one', () => {
		// the number-type fault of `n: 1` and the TypeScript one of `odd` are independent; dropping the first line
		// would leave the other fault, which is no shrink of this one
		const faults = disagreements(['odd: 1\nn: 1'], { rust: fake, go: floats })[0]!.faults
		expect(faults[0]).toEqual({ mode: 0, odd: 'ts' })
		expect(shrink('odd: 1\nn: 1', faults[0]!, { rust: fake, go: floats })).toBe('odd: 1')
	})
})
