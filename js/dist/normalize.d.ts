/**
 * Shared, domain-agnostic parsing primitives: the parse context threaded
 * through every module, Core §9's resource limits, and the length/duplicate
 * checks built on them. Every other Core module (`scalars.ts`, `flow.ts`,
 * `block.ts`, `core.ts`) sits above this one.
 */
import { type LimaValue, SCALAR_LENGTH_LIMIT } from './value.js';
export { SCALAR_LENGTH_LIMIT };
/** Core §11.2: the minimal `onWarning` diagnostic shape — message and line only. */
export type Diagnostic = {
    message: string;
    line: number;
};
/**
 * Threaded through the whole recursive descent instead of a bare `strict`
 * boolean, so `onWarning` reaches every call site that can emit a warning
 * (currently just duplicate-key detection) without growing every
 * function's parameter list further as new warning types are added.
 */
export type ParseContext = {
    strict: boolean;
    onWarning?: (diagnostic: Diagnostic) => void;
};
export declare const DOCUMENT_SIZE_LIMIT = 65536;
export declare const KEY_LENGTH_LIMIT = 128;
export declare const TOP_LEVEL_KEY_LIMIT = 128;
export declare const NESTING_DEPTH_LIMIT = 16;
export declare const byteLength: (s: string) => number;
export declare const checkScalarLimit: (v: LimaValue, line: number) => void;
/**
 * `line` is a thunk, not a plain number: computing a top-level key's line
 * can trigger an O(document length) scan (see `keyLine` in core.ts) the very
 * first time it's called, and this check runs for every key in the
 * document. Evaluating it eagerly would pay that cost on every parse, even
 * though the overwhelming majority of keys never violate the limit — the
 * thunk defers it to the one branch that actually needs a line number.
 */
export declare const checkKeyLength: (key: string, line: () => number) => void;
export declare const checkDuplicateKey: (exists: boolean, key: string, line: number, ctx: ParseContext) => void;
export declare const checkDuplicateKeyMap: (entries: Map<string, unknown>, key: string, line: number, ctx: ParseContext) => void;
