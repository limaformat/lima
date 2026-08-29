/** Reference tokens recorded while the annotated Core tree is being built. */
export type ReferenceToken2 = {
    token: string;
    /**
     * Index of the token within the decoded scalar value — the splice point
     * for interpolation. A UTF-16 offset (JS `String.slice` units); stays
     * implementation-local, unlike `line`/`offset`.
     */
    index: number;
    /** Physical 1-based source line of the token (References 2.0 §2.4). */
    line: number;
    /**
     * 0-based **codepoint** offset of the token within its source line — the
     * `column - 1` a diagnostic reports, and the tie-break key for §5 error
     * ordering. Identical across implementations.
     */
    offset: number;
    documentPath?: string;
    partialPath?: string;
};
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
export type ReferenceSource = {
    raw?: string;
    line: number;
    col: number;
    tabAdjust?: number[];
};
export declare const PURE_REFERENCE_2: RegExp;
export declare const scanReferenceTokens2: (value: string, source: ReferenceSource | undefined) => ReferenceToken2[];
