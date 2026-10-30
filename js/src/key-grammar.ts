import { UNICODE_KEY_RANGES } from './unicode-key-table.js'

const unicodeKeyCategory = (codePoint: number): number => {
	let low = 0
	let high = UNICODE_KEY_RANGES.length / 3
	while (low < high) {
		const mid = (low + high) >>> 1
		const offset = mid * 3
		if (codePoint < UNICODE_KEY_RANGES[offset]!) high = mid
		else if (codePoint > UNICODE_KEY_RANGES[offset + 1]!) low = mid + 1
		else return UNICODE_KEY_RANGES[offset + 2]!
	}
	return 0
}

export const isKeyInitialCodePoint = (c: number): boolean => {
	if (c <= 0x7f) return c === 95 || c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122
	return (unicodeKeyCategory(c) & 5) !== 0 // L or N
}

export const isKeyCharacterCodePoint = (c: number): boolean => {
	if (c <= 0x7f) return isKeyInitialCodePoint(c) || c === 58 || c === 45 || c === 42
	return c === 0xb7 || unicodeKeyCategory(c) !== 0 // L, M or N
}

export const isValidUnquotedKey = (raw: string, allowSlash = false): boolean => {
	if (raw.length === 0) return false
	let i = 0
	let cp = raw.charCodeAt(0)
	if (cp <= 0x7f) {
		if (!(cp === 95 || cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122)) return false
		i = 1
	} else {
		cp = raw.codePointAt(0)!
		if (!isKeyInitialCodePoint(cp)) return false
		i = cp > 0xffff ? 2 : 1
	}
	while (i < raw.length) {
		cp = raw.charCodeAt(i)
		if (cp <= 0x7f) {
			if (!(cp === 95 || cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 ||
				cp === 58 || cp === 45 || cp === 42 || allowSlash && cp === 47)) return false
		} else {
			cp = raw.codePointAt(i)!
			if (!isKeyCharacterCodePoint(cp)) return false
		}
		i += cp > 0xffff ? 2 : 1
	}
	return true
}
