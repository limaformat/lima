import { isTrimWhitespace } from './chars.js'
import { isValidUnquotedKey } from './key-grammar.js'

export const KEY_GRAMMAR_HINT = ' (an unquoted key starts with a Unicode letter or number or "_", then has letters, marks, numbers, "_", ":", "-", "*" and "·"; quote any other)'

/**
 * The key a line that is no entry seems to hold: the text before its first colon that a space or a tab follows, or
 * before the colon that ends it (§5.1); undefined without either.
 */
const keyCandidate = (text: string): string | undefined => {
	for (let colon = text.indexOf(':'); colon !== -1; colon = text.indexOf(':', colon + 1)) {
		const next = text.charCodeAt(colon + 1)
		if (next === 32 || next === 9 || colon === text.length - 1) return text.slice(0, colon)
	}
	return undefined
}

export const specificKeyHint = (text: string): string | undefined => {
	let i = 0
	while (text.charCodeAt(i) === 32) i++
	const cp = text.codePointAt(i)
	if (cp !== undefined && cp !== 32 && isTrimWhitespace(cp)) {
		return ` (U+${cp.toString(16).toUpperCase().padStart(4, '0')} before the key; Lima indents by spaces only)`
	}
	const colon = text.indexOf('：')
	if (colon > 0 && isValidUnquotedKey(text.slice(0, colon))) {
		return ' (the key-value separator is ": " (U+003A and a space), not U+FF1A FULLWIDTH COLON)'
	}
	// Appendix E: what YAML front matter writes in a key, and what Lima writes instead
	const key = keyCandidate(text.slice(i))
	if (key === undefined) return undefined
	if (key === '<<') return ' (a YAML merge key; Lima has no merge keys)'
	const words = key.split(' ')
	if (words.length > 1 && words.every((word) => isValidUnquotedKey(word))) {
		return ` (quote a key that holds spaces: '${key}':)`
	}
	const parts = key.split('.')
	if (parts.length > 1 && parts.every((part) => isValidUnquotedKey(part))) {
		return ` (Lima nests by indentation: "${parts[0]}:", and "${parts[1]}:" below it)`
	}
	return undefined
}
