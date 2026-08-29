/**
 * Core §6.1.5 literal block scalars (`|`). Shared by the top-level key path
 * (`core.ts`) and the nested block path (`block.ts`): §6.1.5 defines block
 * scalar extent generically ("indentation strictly greater than the
 * indentation of the key that introduced the scalar"), with no top-level
 * restriction, so both call sites must agree byte for byte.
 *
 * Generic over the output representation via `ValueBuilder` (see
 * `builder.ts`), like the rest of the Core grammar.
 */

import { LString } from './value.js'
import { type ParseContext, checkScalarLimit } from './normalize.js'
import type { ValueBuilder } from './builder.js'

/** Leading U+0020 count. "Indentation" in §6.1.5 is spaces, measured from column 0. */
export const leadingSpaces = (line: string): number => {
	let i = 0
	while (i < line.length && line.charCodeAt(i) === 32) i++
	return i
}

/** Index right after the last non-space character — the `trimEnd()` boundary, without allocating. */
export const trailingSpaceEnd = (line: string): number => {
	let i = line.length
	while (i > 0 && line.charCodeAt(i - 1) === 32) i--
	return i
}

/**
 * Builds a `|` block scalar value.
 *
 * `bodyLines` are the physical source lines *after* the `|` line, each in
 * its original column-0 form (trailing whitespace is stripped here).
 * `keyIndent` is the indentation of the key that introduced the scalar
 * (0 at the top level). `pipeLine` is the 1-based line number of the `|`
 * line, so `bodyLines[i]` is at `pipeLine + 1 + i`.
 *
 * Returns the joined value plus how many of `bodyLines` the scalar
 * consumed — a caller iterating physical lines resumes past that; a caller
 * that already sliced the range to the scalar can ignore it.
 */
export const buildBlockScalar = <V, M>(
	bodyLines: string[], keyIndent: number, pipeLine: number,
	ctx: ParseContext, builder: ValueBuilder<V, M>,
): { value: V; consumed: number } => {
	// Extent (§6.1.5): a line belongs to the scalar iff its indentation is
	// strictly greater than the introducing key's. Empty lines between
	// content lines belong regardless of indentation; the first non-empty
	// line dedented to the key's column or less ends the scalar, `#` lines
	// included.
	let consumed = bodyLines.length
	for (let i = 0; i < bodyLines.length; i++) {
		const bl = bodyLines[i]
		const ind = leadingSpaces(bl)
		if (ind === bl.length) continue // empty (blank or whitespace-only)
		if (ind <= keyIndent) { consumed = i; break }
	}
	const lines = consumed === bodyLines.length ? bodyLines : bodyLines.slice(0, consumed)

	// Content indentation (§6.1.5): the smallest number of leading spaces
	// among all non-empty content lines, measured from column 0, removed
	// uniformly from every line.
	let minIndent = Infinity
	for (const l of lines) {
		const ind = leadingSpaces(l)
		if (ind === l.length) continue // empty lines do not participate
		if (ind < minIndent) minIndent = ind
	}
	const trimAmt = isFinite(minIndent) ? minIndent : 0

	// dedent + `^^` continuation strip + trailing-space trim collapse into a
	// single slice() per line. leadingSpaces/trailingSpaceEnd avoid the
	// temporary strings trim()/trimStart()/trimEnd() would allocate.
	const merged: string[] = []
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i]
		const lineLen = l.length
		let start = trimAmt < lineLen ? trimAmt : lineLen
		const isContinuation = l.charCodeAt(start) === 94 && l.charCodeAt(start + 1) === 94 // ^^
		if (isContinuation) start += 2
		let end = trailingSpaceEnd(l)
		if (end < start) end = start
		const content = l.slice(start, end)
		if (isContinuation && merged.length > 0) {
			if (content) merged[merged.length - 1] += ' ' + content
		} else {
			merged.push(content)
		}
	}

	// Trailing content (§6.1.5): all trailing empty lines are stripped.
	while (merged.length > 0 && merged[merged.length - 1] === '') merged.pop()

	const joined = merged.join('\n')
	checkScalarLimit(LString(joined), pipeLine)
	// A token's physical `(line, offset)` is read from the original body
	// lines (column-0 form), not reconstructed from the dedented/`^^`-merged
	// `joined` string — References 2.0 §2.4. `lines` are at physical lines
	// `pipeLine + 1 .. pipeLine + consumed` (0-based indices `pipeLine ..`).
	return {
		value: builder.string(joined, pipeLine + 1, false, {
			raw: lines.join('\n'), line: pipeLine + 1, col: 0,
			tabAdjust: ctx.tabAdjust?.slice(pipeLine, pipeLine + consumed),
		}),
		consumed,
	}
}
