/** Exact ECMAScript WhiteSpace + LineTerminator set for one UTF-16 code unit. */
export const isTrimWhitespace = (c: number): boolean =>
	c === 0x0009 || (c >= 0x000a && c <= 0x000d) || c === 0x0020 || c === 0x00a0 ||
	c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
	c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff

/**
 * `s` without the whitespace (§1) it ends with — `s` itself, not a copy, when its last character is none, as a value's
 * mostly is.
 */
export const trimEndWhitespace = (s: string): string =>
	isTrimWhitespace(s.charCodeAt(s.length - 1)) ? s.trimEnd() : s
