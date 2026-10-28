/**
 * Core 1.1 §4, §7.1 rule 5 and §10.1: in strict mode every content line belongs to the structure. Between two
 * top-level keys (and before the first), a line that is neither blank nor a comment is
 *
 *   - unrecognised (`UNRECOGNIZED_LINE`) when it starts at column 0: it matches no key pattern, or the scanner would
 *     have ended the range at it;
 *   - inconsistently indented (`INVALID_INDENTATION`) when it is indented and the range belongs to no block: before
 *     the first key, or after a key with an inline value other than `|`, which opens no block.
 *
 * The indented lines under a block value or a `|` scalar are its own and are checked where they are parsed. Non-strict
 * mode skips all of these lines, as Core 1.0 did in both modes.
 */
import { isTrimWhitespace } from './chars.js'
import { LimaError } from './errors.js'

/** Whether the lines after a key belong to it: `block` (a nested block or a `|` scalar) or `inline` (they do not). */
export type RangeOwner = 'none' | 'inline' | 'block'

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
	while (pos < end) {
		const lineEnd = frontMatter.indexOf('\n', pos)
		const stop = lineEnd === -1 || lineEnd > end ? end : lineEnd
		const text = frontMatter.slice(pos, stop)
		// blank and comment lines by Lima's own whitespace; indentation by ASCII space only (§3 expanded the tabs)
		let first = 0
		while (first < text.length && isTrimWhitespace(text.charCodeAt(first))) first++
		const content = text.slice(first)
		if (content !== '' && !content.startsWith('#')) {
			if (!text.startsWith(' ')) {
				throw new LimaError({
					code: 'UNRECOGNIZED_LINE', line: current,
					message: `Lima: unrecognised line at line ${current}: "${text}"${hint(text)}`,
				})
			}
			if (owner !== 'block') {
				throw new LimaError({
					code: 'INVALID_INDENTATION', line: current,
					message: `Lima: unexpected indentation at line ${current}: "${content}"${yamlHint(inlineValue)}`,
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
