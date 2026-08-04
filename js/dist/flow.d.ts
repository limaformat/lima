/** Core §15.8 flow collections: `[...]` sequences and `{...}` mappings. */
import { type ParseContext } from './normalize.js';
import { type PositionedValue } from './scalars.js';
export declare const parseFlowSequence: (val: string, ctx: ParseContext, line: number) => PositionedValue[] | null;
export declare const parseFlowMapping: (val: string, ctx: ParseContext, line: number) => PositionedValue | null;
