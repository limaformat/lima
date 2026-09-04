import { type Diagnostic } from './core.js';
type Meta = Record<string, unknown>;
export type ParseMode = 'references' | 'core';
export type ParseOptions = {
    mode?: ParseMode;
    partials?: Meta;
    strict?: boolean;
    onWarning?: (diagnostic: Diagnostic) => void;
};
export declare const parse: <T extends Record<string, unknown> = Meta>(frontMatter: string, options?: ParseOptions) => T;
/** Test oracle: exercises the resolver without its dependency-result cache. */
export declare const __parseWithoutResolveCacheForTest: <T extends Record<string, unknown> = Meta>(frontMatter: string, options?: ParseOptions) => T;
/** @deprecated Use parse(). */
export declare const parseReferences: typeof parse;
export {};
