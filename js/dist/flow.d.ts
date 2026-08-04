/** Core §15.8 flow collections: `[...]` sequences and `{...}` mappings. */
import { type ParseContext } from './normalize.js';
import type { ValueBuilder } from './builder.js';
export declare const parseFlowSequence: <V, M>(val: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>) => V[] | null;
export declare const parseFlowMapping: <V, M>(val: string, ctx: ParseContext, line: number, builder: ValueBuilder<V, M>) => V | null;
