import { describe, expect, test } from 'bun:test'
import { BlockCursor } from './block-cursor'

describe('BlockCursor', () => {
	test('reports UTF-16 spans without splitting astral content', () => {
		const source = '  😀 value\n\tkey\n'
		const cursor = new BlockCursor(source, 0, source.length)
		expect(cursor.next()).toBe(true)
		expect(source.slice(cursor.contentStart, cursor.lineEnd)).toBe('😀 value')
		expect(cursor.indent).toBe(2)
		expect(cursor.next()).toBe(true)
		expect(source.slice(cursor.contentStart, cursor.lineEnd)).toBe('key')
	})

	test('uses the complete trimStart whitespace set after ASCII indentation', () => {
		for (const cp of [0x09, 0x0b, 0x0c, 0xa0, 0x1680, 0x2000, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]) {
			const ws = String.fromCharCode(cp)
			const source = ` ${ws}key\n`
			const cursor = new BlockCursor(source, 0, source.length)
			expect(cursor.next()).toBe(true)
			expect(cursor.contentStart).toBe(2)
			expect(cursor.asciiIndent).toBe(1)
			expect(cursor.indent).toBe(2)
		}
	})

})
