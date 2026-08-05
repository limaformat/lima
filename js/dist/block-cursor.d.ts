/**
 * Allocation-free physical-line cursor over one top-level block extent.
 * Positions are UTF-16 code-unit offsets. Structural boundaries are ASCII;
 * indentation additionally follows the complete whitespace predicate used by
 * `trimStart()`, matching the existing block grammar.
 */
export declare class BlockCursor {
    readonly source: string;
    readonly rangeStart: number;
    readonly rangeEnd: number;
    lineStart: number;
    lineEnd: number;
    contentStart: number;
    indent: number;
    asciiIndent: number;
    lineIndex: number;
    valid: boolean;
    maxIndent: number;
    private nextStart;
    constructor(source: string, rangeStart: number, rangeEnd: number);
    next(): boolean;
    get empty(): boolean;
    get firstCode(): number;
}
