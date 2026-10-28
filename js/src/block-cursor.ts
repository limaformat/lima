import { isTrimWhitespace } from './chars.js'

/**
 * Allocation-free physical-line cursor over one top-level block extent.
 * Positions are UTF-16 code-unit offsets. Indentation is the run of spaces
 * (Core 1.1 §7.1); other whitespace after it, such as U+00A0, starts the
 * content of a line that has any, and only a blank or comment line looks
 * past it (the complete whitespace predicate used by `trimStart()`).
 */
export class BlockCursor {
	lineStart = 0
	lineEnd = 0
	contentStart = 0
	indent = 0
	asciiIndent = 0
	lineIndex = -1
	valid = false
	maxIndent = 0

	private nextStart: number

	constructor(
		readonly source: string,
		readonly rangeStart: number,
		readonly rangeEnd: number,
	) {
		this.nextStart = rangeStart
	}

	next(): boolean {
		if (this.nextStart >= this.rangeEnd) {
			this.valid = false
			return false
		}

		const start = this.nextStart
		const newline = this.source.indexOf('\n', start)
		const end = newline === -1 || newline >= this.rangeEnd ? this.rangeEnd : newline
		let content = start
		while (content < end && this.source.charCodeAt(content) === 0x20) content++
		const asciiEnd = content
		// After ordinary space indentation, printable ASCII starts content
		// immediately. Only ASCII control whitespace or non-ASCII code units
		// need the complete trimStart-compatible predicate.
		if (content < end) {
			let code = this.source.charCodeAt(content)
			if ((code >= 0x09 && code <= 0x0d) || code > 0x7f) {
				do {
					if (!isTrimWhitespace(code)) break
					content++
					code = this.source.charCodeAt(content)
				} while (content < end)
			}
		}

		// other whitespace before content is no indentation: the content starts at it (Core 1.1 §7.1)
		if (content > asciiEnd && content < end && this.source.charCodeAt(content) !== 35) content = asciiEnd

		this.lineStart = start
		this.lineEnd = end
		this.contentStart = content
		this.asciiIndent = asciiEnd - start
		this.indent = content - start
		if (this.indent > this.maxIndent) this.maxIndent = this.indent
		this.lineIndex++
		this.valid = true
		this.nextStart = newline === -1 || newline >= this.rangeEnd ? this.rangeEnd : newline + 1
		return true
	}

	get empty(): boolean {
		return this.contentStart === this.lineEnd
	}

	get firstCode(): number {
		return this.source.charCodeAt(this.contentStart)
	}

}
