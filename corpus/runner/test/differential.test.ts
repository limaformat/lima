import { describe, it, expect, afterAll } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	canonical, disagreements, generateDocument, isKnownOpen, probeOutcomes, seededRng, shrink, typescriptOutcomes,
} from '../src/differential'

const documents = (seed: number, n: number): string[] => {
	const rng = seededRng(seed)
	return Array.from({ length: n }, () => generateDocument(rng))
}

// A probe that answers as TypeScript does, except that it crashes on "boom" and reads "odd" as an empty mapping:
// the comparison and the crash isolation are tested without the Rust and Go builds.
const dir = mkdtempSync(join(tmpdir(), 'lima-differential-'))
const fake = join(dir, 'probe')
writeFileSync(fake, `#!/usr/bin/env bun
import { typescriptOutcomes } from ${JSON.stringify(join(import.meta.dir, '../src/differential'))}
const documents = JSON.parse(await Bun.stdin.text())
if (documents.some((d) => d.includes('boom'))) process.exit(3)
console.log(JSON.stringify(documents.flatMap((d) => d.includes('odd') ? [{ value: {}, warnings: [] }, { value: {}, warnings: [] }] : typescriptOutcomes(d))))
`)
chmodSync(fake, 0o755)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('generateDocument', () => {
	it('gives the same documents for the same seed, and others for another', () => {
		expect(documents(7, 200)).toEqual(documents(7, 200))
		expect(documents(8, 200)).not.toEqual(documents(7, 200))
	})

	it('writes the constructs the comparison is for', () => {
		const all = documents(1, 2000).join('\n')
		for (const construct of ['\n- ', ': |', '\t', '\r\n', '[', '{', '2026-10-28', '# ', '---']) {
			expect(all).toContain(construct)
		}
		// a compact sequence: an item at the column of the bare key before it
		expect(/(^|\n)( *)[^ \n-][^\n]*:\n\2- /.test(all)).toBe(true)
	})
})

describe('isKnownOpen', () => {
	it('leaves out content indented by Unicode whitespace, and nothing else', () => {
		expect(isKnownOpen('a:\n \u00a0b: 1\n')).toBe(true)
		expect(isKnownOpen('a:\n\u00a0b: 1\n')).toBe(true)
		expect(isKnownOpen('a:\n  b: 1\n\u00a0\n')).toBe(false)
		expect(isKnownOpen('a: x\u00a0y\n\tb: 1\n')).toBe(false)
	})
})

describe('typescriptOutcomes', () => {
	it('writes both modes in the probes\' form: a date as $date, warnings by line, errors by code and line', () => {
		expect(typescriptOutcomes('d: 2026-10-28\nd: 1\n')).toEqual([
			{ value: { d: 1 }, warnings: [2] },
			{ error: 'DUPLICATE_KEY', line: 2 },
		])
		expect(typescriptOutcomes('d: 2026-10-28T14:30:00+02:00\n')[0])
			.toEqual({ value: { d: { $date: '2026-10-28T12:30:00Z' } }, warnings: [] })
	})

	it('compares mappings regardless of member order', () => {
		expect(canonical({ value: { a: 1, b: 2 }, warnings: [] })).toBe(canonical({ value: { b: 2, a: 1 }, warnings: [] }))
	})
})

describe('probes', () => {
	const probes = { rust: fake, go: fake }

	it('pins a crash to its document', () => {
		const outcomes = probeOutcomes(fake, ['a: 1\n', 'boom: 1\n', 'b: 2\n'])
		expect(outcomes).toHaveLength(6)
		expect(outcomes.slice(0, 2)).toEqual(typescriptOutcomes('a: 1\n'))
		expect(outcomes[2]).toHaveProperty('crash')
		expect(outcomes.slice(4)).toEqual(typescriptOutcomes('b: 2\n'))
	})

	it('reports the documents the implementations disagree on, shrunk to the lines that matter', () => {
		const found = disagreements(['a: 1\n', 'odd: 1\n', 'boom: 1\n'], probes)
		expect(found.map((d) => d.document)).toEqual(['odd: 1\n', 'boom: 1\n'])
		expect(found[0]!.odd).toBe('ts')
		expect(shrink('a: 1\nb: 2\nodd: 3\nc: 4', probes)).toBe('odd: 3')
	})
})
