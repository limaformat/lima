/** Core §15.8 flow collections: `[...]` sequences and `{...}` mappings. */
import { type ParseContext } from './normalize.js';
import type { ValueBuilder } from './builder.js';
export declare const parseFlowSequence: <V>(val: string, ctx: ParseContext, line: number, builder: ValueBuilder<V>) => V[] | null;
export declare const parseFlowMapping: <V>(val: string, ctx: ParseContext, line: number, builder: ValueBuilder<V>) => V | null;
