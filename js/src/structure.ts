/**
 * Core 1.1 §4, §7.1 rule 5 and §10.1: in strict mode every content line belongs to the structure. Between two
 * top-level keys (and before the first), a line that is neither blank nor a comment is
 *
 *   - unrecognised (`UNRECOGNIZED_LINE`) when it starts at column 0: it matches no key pattern, or the scanner would
 *     have ended the range at it;
 *     A sequence that starts at column 0 under a bare key is that key's (Core 1.1 §7.2), up to the first line at
 *     column 0 that is no item.
 *   - inconsistently indented (`INVALID_INDENTATION`) when it is indented and no block owns it: before the first key;
 *     after a key with an inline value other than `|`, which opens no block; under a block mapping, but less indented
 *     than its first line (its base indentation, §7.1 rule 1), where the block parser stops; or after a `|` scalar
 *     that a line at column 0 ended (§6.1.5).
 *
 * The lines a block mapping or a `|` scalar owns are checked where they are parsed. Non-strict mode skips all of
 * these lines, as Core 1.0 did in both modes.
 */
import { isTrimWhitespace } from './chars.js'
import { LimaError } from './errors.js'

/**
 * What the lines after a key belong to: nothing (`none`, before the first key; `inline`, after an inline value), a
 * block mapping or sequence (`mapping`, after a bare key) or a `|` scalar (`scalar`).
 */
export type RangeOwner = 'none' | 'inline' | 'mapping' | 'scalar'

/**
 * Checks the lines of `frontMatter` from `start` (a line start) to `end` that follow a key owned as `owner`; `line`
 * is the 1-based line at `start`; `inlineValue` is the value of that key, for the hint a YAML marker earns. Throws for
 * the first line that belongs to no structure.
 */
export function checkRangeLines(
	frontMatter: string, start: number, end: number, line: number, owner: RangeOwner, inlineValue = '',
): void {
	let pos = start
	let current = line
	let base = -1 // a block mapping's base indentation, once its first content line set it
	let scalarOpen = owner === 'scalar'
	while (pos < end) {
		const lineEnd = frontMatter.indexOf('\n', pos)
		const stop = lineEnd === -1 || lineEnd > end ? end : lineEnd
		const text = frontMatter.slice(pos, stop)
		let indent = 0
		while (indent < text.length && text.charCodeAt(indent) === 32) indent++
		// §6.1.5: a `|` scalar holds every line up to the first non-empty one at its key's column (0), `#` included
		if (scalarOpen && (indent === text.length || indent > 0)) {
			pos = lineEnd + 1
			current++
			if (lineEnd === -1 || lineEnd >= end) break
			continue
		}
		scalarOpen = false
		// blank and comment lines by Lima's own whitespace; indentation by ASCII space only (§3 expanded the tabs)
		let first = 0
		while (first < text.length && isTrimWhitespace(text.charCodeAt(first))) first++
		const content = text.slice(first)
		if (content !== '' && !content.startsWith('#')) {
			// §7.2: a bare key's sequence may start at its own column, 0 here; it ends at the first line there that is no
			// item
			const item = indent === 0 && isItem(text)
			if (owner === 'mapping' && base === -1 && item) base = 0
			if (indent === 0 && !(base === 0 && item)) {
				throw new LimaError({
					code: 'UNRECOGNIZED_LINE', line: current,
					message: `Lima: unrecognised line at line ${current}: "${text}"${hint(text)}`,
				})
			}
			if (owner === 'mapping' && base === -1) base = indent
			if (indent > 0 && !(owner === 'mapping' && indent >= base)) {
				throw new LimaError({
					code: 'INVALID_INDENTATION', line: current,
					message: `Lima: unexpected indentation at line ${current}: "${content}"${owner === 'inline' ? yamlHint(inlineValue) : ''}`,
				})
			}
		}
		if (lineEnd === -1 || lineEnd >= end) break
		pos = lineEnd + 1
		current++
	}
}

/** Whether the inline value that starts at `rawStart` and ends its line at `lineEnd` is a `|` block scalar marker. */
export const isBlockScalarMarker = (frontMatter: string, rawStart: number, lineEnd: number): boolean =>
	frontMatter.slice(rawStart, lineEnd).trim() === '|'

/** What a reader likely meant by an unrecognised line, as a hint after the message; none for anything else. */
const hint = (text: string): string => {
	if (text === '---' || text === '...') return ' (a YAML document marker; Lima has one document)'
	if (isItem(text)) return ' (a sequence item belongs to a key with no value of its own)'
	if (text.startsWith('"') || text.startsWith("'")) return ' (a quoted key closes on its own line)'
	// `author Odile`, `key:value`: key characters, but no ": " after them
	if (!text.includes(':') || /^[a-zA-Z0-9_][a-zA-Z0-9_:-]*$/.test(text.split(' ')[0]!)) return ' (a key needs ": " after it)'
	return ' (an unquoted key has letters, digits, "_", "-" and ":" only; quote any other)'
}

/** The hint a YAML block scalar marker in place of a value earns; none for any other value. */
const yamlHint = (value: string): string => {
	if (value === '>' || value === '>-' || value === '>+')
		return ` ("${value}" is YAML's folded scalar; Lima writes "|" and continues a line with "^^")`
	if (value === '|-' || value === '|+') return ` ("${value}" is a YAML chomping indicator; Lima writes "|")`
	return ''
}

/** §7.2: `-` alone or `-` followed by whitespace begins a sequence item (Core 1.1); `---` or `-x` does not. */
const isItem = (text: string): boolean =>
	text.charCodeAt(0) === 45 && (text.length === 1 || isTrimWhitespace(text.charCodeAt(1)))
