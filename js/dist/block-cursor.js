import { isTrimWhitespace } from './chars.js';
/**
 * Allocation-free physical-line cursor over one top-level block extent.
 * Positions are UTF-16 code-unit offsets. Structural boundaries are ASCII;
 * indentation additionally follows the complete whitespace predicate used by
 * `trimStart()`, matching the existing block grammar.
 */
export class BlockCursor {
    source;
    rangeStart;
    rangeEnd;
    lineStart = 0;
    lineEnd = 0;
    contentStart = 0;
    indent = 0;
    asciiIndent = 0;
    lineIndex = -1;
    valid = false;
    maxIndent = 0;
    nextStart;
    constructor(source, rangeStart, rangeEnd) {
        this.source = source;
        this.rangeStart = rangeStart;
        this.rangeEnd = rangeEnd;
        this.nextStart = rangeStart;
    }
    next() {
        if (this.nextStart >= this.rangeEnd) {
            this.valid = false;
            return false;
        }
        const start = this.nextStart;
        const newline = this.source.indexOf('\n', start);
        const end = newline === -1 || newline >= this.rangeEnd ? this.rangeEnd : newline;
        let content = start;
        while (content < end && this.source.charCodeAt(content) === 0x20)
            content++;
        const asciiEnd = content;
        // After ordinary space indentation, printable ASCII starts content
        // immediately. Only ASCII control whitespace or non-ASCII code units
        // need the complete trimStart-compatible predicate.
        if (content < end) {
            let code = this.source.charCodeAt(content);
            if ((code >= 0x09 && code <= 0x0d) || code > 0x7f) {
                do {
                    if (!isTrimWhitespace(code))
                        break;
                    content++;
                    code = this.source.charCodeAt(content);
                } while (content < end);
            }
        }
        this.lineStart = start;
        this.lineEnd = end;
        this.contentStart = content;
        this.asciiIndent = asciiEnd - start;
        this.indent = content - start;
        if (this.indent > this.maxIndent)
            this.maxIndent = this.indent;
        this.lineIndex++;
        this.valid = true;
        this.nextStart = newline === -1 || newline >= this.rangeEnd ? this.rangeEnd : newline + 1;
        return true;
    }
    get empty() {
        return this.contentStart === this.lineEnd;
    }
    get firstCode() {
        return this.source.charCodeAt(this.contentStart);
    }
}
