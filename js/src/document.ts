import { LimaError } from './errors.js'

/** Core §1: a document is a sequence of Unicode scalar values. */
export const validateDocument = (document: string): void => {
	// Node 22's native scalar-value check keeps the common valid path out of
	// JavaScript. Only malformed input pays for the line-attribution walk.
	if (document.isWellFormed()) return
	let line = 1
	for (let i = 0; i < document.length; i++) {
		const c = document.charCodeAt(i)
		if (c === 10) { line++; continue }
		if (c >= 0xd800 && c <= 0xdbff && i + 1 < document.length) {
			const low = document.charCodeAt(i + 1)
			if (low >= 0xdc00 && low <= 0xdfff) { i++; continue }
		}
		if (c >= 0xd800 && c <= 0xdfff) {
			throw new LimaError({
				code: 'INVALID_DOCUMENT', line,
				message: `Lima: document contains an invalid Unicode scalar value at line ${line}`,
			})
		}
	}
}
