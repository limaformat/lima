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

const SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*'
const DOC_PATH = `${SEGMENT}(?:\\.${SEGMENT})*`
const PARTIAL_NAME = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*'
const PARTIAL_PATH = `${PARTIAL_NAME}(?:\\.${SEGMENT})*`
export const PURE_REFERENCE_2 = new RegExp(`^(?:\\$\\{(${DOC_PATH})\\}|\\$\\((${PARTIAL_PATH})\\))$`)
const REFERENCE_2 = new RegExp(`\\$\\{(${DOC_PATH})\\}|\\$\\((${PARTIAL_PATH})\\)`, 'g')
const NO_TOKENS: ReferenceToken2[] = []

type DecodedMatch = { token: string; index: number; documentPath?: string; partialPath?: string }

/** Codepoint length of the UTF-16 slice `[a, b)` of `s`. */
const codepointLen = (s: string, a: number, b: number): number => {
	let n = 0
	for (let i = a; i < b; ) { i += s.codePointAt(i)! > 0xffff ? 2 : 1; n++ }
	return n
}

/** Splice points (decoded value order): token text, UTF-16 index, path. */
const scanDecoded = (value: string): DecodedMatch[] => {
	REFERENCE_2.lastIndex = 0
	const out: DecodedMatch[] = []
	for (const m of value.matchAll(REFERENCE_2)) {
		out.push({
			token: m[0], index: m.index ?? 0,
			...(m[1] !== undefined ? { documentPath: m[1] } : { partialPath: m[2]! }),
		})
	}
	return out
}

/** Physical `(line, offset)` of each token, in source order, from the raw text. */
const scanPhysical = (
	raw: string, firstLine: number, firstCol: number, tabAdjust?: number[],
): { line: number; offset: number }[] => {
	REFERENCE_2.lastIndex = 0
	const out: { line: number; offset: number }[] = []
	let scanned = 0
	let line = firstLine
	let col = firstCol
	let lineIndex = 0
	for (const m of raw.matchAll(REFERENCE_2)) {
		const idx = m.index ?? 0
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
