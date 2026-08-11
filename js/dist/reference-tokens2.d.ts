/** Reference tokens recorded while the annotated Core tree is being built. */
import type { StringSourceSpan } from './builder.js';
export type ReferenceToken2 = {
    token: string;
    index: number;
    offset: number;
    line: number;
    documentPath?: string;
    partialPath?: string;
};
export declare const PURE_REFERENCE_2: RegExp;
export declare const scanReferenceTokens2: (value: string, firstLine: number, sourceSpans?: StringSourceSpan[]) => ReferenceToken2[];
