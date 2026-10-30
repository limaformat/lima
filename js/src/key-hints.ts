import { isTrimWhitespace } from './chars.js'
import { isValidUnquotedKey } from './key-grammar.js'

export const KEY_GRAMMAR_HINT = ' (an unquoted key starts with a Unicode letter or number or "_", then has letters, marks, numbers, "_", ":", "-", "*" and "·"; quote any other)'

export const specificKeyHint = (text: string): string | undefined => {
	let i = 0
	while (text.charCodeAt(i) === 32) i++
	const cp = text.codePointAt(i)
	if (cp !== undefined && cp !== 32 && isTrimWhitespace(cp)) {
		return ` (U+${cp.toString(16).toUpperCase().padStart(4, '0')} before the key; Lima indents by spaces only)`
	}
	const colon = text.indexOf('\uFF1A')
	if (colon > 0 && isValidUnquotedKey(text.slice(0, colon))) {
		return ' (the key-value separator is ": " (U+003A and a space), not U+FF1A FULLWIDTH COLON)'
	}
	return undefined
}
