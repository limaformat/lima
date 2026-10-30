/** Reference tokens recorded while the annotated Core tree is being built. */

export type ReferenceToken2 = {
	token: string
	/**
	 * Index of the token within the decoded scalar value — the splice point
	 * for interpolation. A UTF-16 offset (JS `String.slice` units); stays
	 * implementation-local, unlike `line`/`offset`.
	 */
	index: number
	/** Physical 1-based source line of the token (References 2.0 §2.4). */
	line: number
	/**
	 * 0-based **codepoint** offset of the token within its source line — the
	 * `column - 1` a diagnostic reports, and the tie-break key for §5 error
	 * ordering. Identical across implementations.
	 */
	offset: number
	documentPath?: string
	partialPath?: string
}

/**
 * Where a scalar begins in the source: physical 1-based `line` and 0-based
 * codepoint column `col` of its first character. A token's position is this
 * anchor plus its codepoint offset within the value.
 *
 * `raw` is the value text a token's position is *read from*, before comment
 * stripping and `\#` collapse (so `x: a\#b ${t}` reports `${t}` at its real
 * column) — for a block scalar it is the original body lines joined with
 * `\n` (§2.4 forbids reconstructing a token's line from the `^^`-merged
 * string). Omitted only when it equals the decoded value.
 *
 * `tabAdjust[i]` is the column count Core §3 added to physical line
 * `line + i` by leading-tab expansion; it is subtracted so the reported
 * column is the *original*-source column (§2.4).
 */
export type ReferenceSource = { raw?: string; line: number; col: number; tabAdjust?: number[] }

import { isKeyCharacterCodePoint, isKeyInitialCodePoint } from './key-grammar.js'
const NO_TOKENS: ReferenceToken2[] = []

const isAsciiReferenceInitial = (c: number): boolean =>
	(c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95

const isAsciiReferenceCharacter = (c: number, allowSlash: boolean): boolean =>
	isAsciiReferenceInitial(c) || c === 58 || c === 45 || c === 42 || allowSlash && c === 47

type DecodedMatch = { token: string; index: number; documentPath?: string; partialPath?: string }

const utf16WidthAt = (text: string, offset: number): number =>
	text.codePointAt(offset)! > 0xffff ? 2 : 1

/** Codepoint length of the UTF-16 slice `[a, b)` of `s`. */
const codepointLen = (s: string, a: number, b: number): number => {
	let n = 0
	for (let i = a; i < b; ) { i += utf16WidthAt(s, i); n++ }
	return n
}

/** Converts a 0-based codepoint offset to JavaScript/LSP UTF-16 units. */
export const codepointOffsetToUtf16 = (text: string, codepointOffset: number): number => {
	let utf16Offset = 0
	let codepoints = 0
	while (utf16Offset < text.length && codepoints < codepointOffset) {
		utf16Offset += utf16WidthAt(text, utf16Offset)
		codepoints++
	}
	return utf16Offset
}

/** Converts a 0-based JavaScript/LSP UTF-16 offset to a codepoint offset. */
export const utf16OffsetToCodepoint = (text: string, utf16Offset: number): number => {
	let currentUtf16 = 0
	let codepoints = 0
	const limit = Math.min(Math.max(utf16Offset, 0), text.length)
	while (currentUtf16 < limit) {
		currentUtf16 += utf16WidthAt(text, currentUtf16)
		codepoints++
	}
	return codepoints
}

/** Splice points (decoded value order): token text, UTF-16 index, path. */
const scanComponent = (value: string, start: number, allowSlash: boolean): number => {
	let i = start
	if (i >= value.length) return -1
	let cp = value.charCodeAt(i)
	if (cp <= 0x7f) {
		if (!isAsciiReferenceInitial(cp)) return -1
	} else {
		cp = value.codePointAt(i)!
		if (!isKeyInitialCodePoint(cp)) return -1
	}
	i += cp > 0xffff ? 2 : 1
	while (i < value.length && isAsciiReferenceCharacter(value.charCodeAt(i), allowSlash)) i++
	while (i < value.length) {
		cp = value.charCodeAt(i)
		if (cp <= 0x7f) break
		cp = value.codePointAt(i)!
		if (!isKeyCharacterCodePoint(cp)) break
		i += cp > 0xffff ? 2 : 1
		while (i < value.length && isAsciiReferenceCharacter(value.charCodeAt(i), allowSlash)) i++
	}
	return i
}

const scanPath = (value: string, start: number, partial: boolean): number => {
	let i = scanComponent(value, start, partial)
	if (i < 0) return -1
	while (value.charCodeAt(i) === 46) {
		const next = scanComponent(value, i + 1, false)
		if (next < 0) return -1
		i = next
	}
	return i
}

const scanDecoded = (value: string): DecodedMatch[] => {
	const out: DecodedMatch[] = []
	for (let i = 0; i + 2 < value.length; ) {
		const partial = value.startsWith('$(', i)
		const document = !partial && value.startsWith('${', i)
		if (!partial && !document) { const cp = value.codePointAt(i)!; i += cp > 0xffff ? 2 : 1; continue }
		const end = scanPath(value, i + 2, partial)
		const close = partial ? 41 : 125
		if (end >= 0 && value.charCodeAt(end) === close) {
			const token = value.slice(i, end + 1)
			const path = value.slice(i + 2, end)
			out.push({ token, index: i, ...(partial ? { partialPath: path } : { documentPath: path }) })
			i = end + 1
		} else i++
	}
	return out
}

/** Physical `(line, offset)` of each token, in source order, from the raw text. */
const scanPhysical = (
	raw: string, firstLine: number, firstCol: number, tabAdjust?: number[],
): { line: number; offset: number }[] => {
	const out: { line: number; offset: number }[] = []
	let scanned = 0
	let line = firstLine
	let col = firstCol
	let lineIndex = 0
	for (const m of scanDecoded(raw)) {
		const idx = m.index
		while (scanned < idx) {
			const cp = raw.codePointAt(scanned)!
			if (cp === 10) { line++; col = 0; lineIndex++ } else col++
			scanned += cp > 0xffff ? 2 : 1
		}
		out.push({ line, offset: col - (tabAdjust?.[lineIndex] ?? 0) })
	}
	return out
}

export const scanReferenceTokens2 = (
	value: string,
	source: ReferenceSource | undefined,
): ReferenceToken2[] => {
	if (!value.includes('${') && !value.includes('$(')) return NO_TOKENS
	const decoded = scanDecoded(value)
	if (decoded.length === 0) return NO_TOKENS

	// The raw and decoded scans see the same tokens in the same order —
	// `\#` collapse and `^^` merge never add or remove a `${…}` / `$(…)`.
	const physical = source === undefined
		? scanPhysical(value, 1, 0)
		: scanPhysical(source.raw ?? value, source.line, source.col, source.tabAdjust)
	if (physical.length !== decoded.length) {
		throw new Error(
			`Lima internal: reference token count mismatch (raw ${physical.length}, decoded ${decoded.length})`,
		)
	}
	return decoded.map((d, i) => ({ ...d, line: physical[i].line, offset: physical[i].offset }))
}
