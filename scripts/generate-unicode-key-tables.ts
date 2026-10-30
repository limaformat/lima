/**
 * Generate the Unicode 18.0 L/M/N tables used by all Lima implementations.
 *
 * Usage:
 *   bun scripts/generate-unicode-key-tables.ts /path/to/UnicodeData.txt
 */
import { resolve } from 'node:path'

const EXPECTED_SHA256 = '0736451de439ae7baf1425136617da495e09ee5afbe6e394374db7009ea08950'
const input = process.argv[2]
if (!input) throw new Error('usage: bun scripts/generate-unicode-key-tables.ts /path/to/UnicodeData.txt')
const bytes = await Bun.file(input).arrayBuffer()
const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
if (digest !== EXPECTED_SHA256) throw new Error(`UnicodeData.txt SHA-256 mismatch: ${digest}`)

type Range = [number, number, number]
const ranges: Range[] = []
let pending: { start: number; category: string } | undefined
const add = (start: number, end: number, category: string) => {
	const mask = category[0] === 'L' ? 1 : category[0] === 'M' ? 2 : category[0] === 'N' ? 4 : 0
	if (!mask || end < 0x80) return
	start = Math.max(start, 0x80)
	const last = ranges.at(-1)
	if (last && last[2] === mask && last[1] + 1 === start) last[1] = end
	else ranges.push([start, end, mask])
}
for (const line of new TextDecoder().decode(bytes).split('\n')) {
	if (!line) continue
	const fields = line.split(';')
	const cp = Number.parseInt(fields[0]!, 16)
	const name = fields[1]!
	const category = fields[2]!
	if (name.endsWith(', First>')) {
		if (pending) throw new Error(`nested First range at ${fields[0]}`)
		pending = { start: cp, category }
	} else if (name.endsWith(', Last>')) {
		if (!pending || pending.category !== category) throw new Error(`unmatched Last range at ${fields[0]}`)
		add(pending.start, cp, category)
		pending = undefined
	} else add(cp, cp, category)
}
if (pending) throw new Error('unterminated First range')

const command = 'bun scripts/generate-unicode-key-tables.ts /path/to/UnicodeData.txt'
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`
const flat = ranges.flat().map(hex)
const wrap = (items: string[], indent: string, width = 110) => {
	const lines: string[] = []
	let line = indent
	for (const item of items) {
		const next = `${item}, `
		if (line.length + next.length > width) { lines.push(line.trimEnd()); line = indent }
		line += next
	}
	if (line.trim()) lines.push(line.trimEnd())
	return lines.join('\n')
}
const header = (comment: string) => `${comment} Generated from UnicodeData.txt 18.0.0; DO NOT EDIT.\n${comment} SHA-256: ${EXPECTED_SHA256}\n${comment} Regenerate: ${command}\n`

const ts = `${header('//')}export const UNICODE_KEY_RANGES = new Uint32Array([\n${wrap(flat, '\t')}\n])\n`
const rs = `${header('//')}#[rustfmt::skip]\npub(crate) static UNICODE_KEY_RANGES: &[u32] = &[\n${wrap(flat, '    ')}\n];\n`
const go = `${header('//')}package lima\n\nvar unicodeKeyRanges = [...]uint32{\n${wrap(flat, '\t')}\n}\n`
await Bun.write(resolve('js/src/unicode-key-table.ts'), ts)
await Bun.write(resolve('rust/src/unicode_key_table.rs'), rs)
await Bun.write(resolve('go/unicode_key_table.go'), go)
console.log(`wrote ${ranges.length} Unicode category ranges`)
