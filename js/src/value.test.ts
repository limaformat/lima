import { describe, it, expect } from 'bun:test'
import { codepointLength } from './value.js'

describe('codepointLength', () => {
	it('returns 0 for an empty string', () => {
		expect(codepointLength('')).toBe(0)
	})

	it('matches .length for pure ASCII', () => {
		expect(codepointLength('Hello, World!')).toBe('Hello, World!'.length)
	})

	it('matches .length for accented Latin/Cyrillic/CJK BMP text (no surrogate pairs needed)', () => {
		const s = 'Über Café Привет 日本語'
		expect(codepointLength(s)).toBe(s.length)
		expect(codepointLength(s)).toBe([...s].length)
	})

	it('counts an astral character (surrogate pair) as one code point, not two', () => {
		const emoji = '😀' // U+1F600, encoded as a UTF-16 surrogate pair
		expect(emoji.length).toBe(2)
		expect(codepointLength(emoji)).toBe(1)
	})

	it('counts correctly when an astral character is mixed with plain text', () => {
		const s = 'before 😀 after'
		expect(codepointLength(s)).toBe([...s].length)
		expect(codepointLength(s)).not.toBe(s.length)
	})

	it('counts correctly with multiple astral characters', () => {
		const s = '😀😁😂🤣'
		expect(codepointLength(s)).toBe(4)
		expect(codepointLength(s)).toBe([...s].length)
	})
})
