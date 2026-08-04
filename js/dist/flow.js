/** Core §15.8 flow collections: `[...]` sequences and `{...}` mappings. */
import { checkKeyLength, checkDuplicateKeyMap } from './normalize.js';
import { parseQuotedOrTyped, stripKeyQuotes } from './scalars.js';
import { LimaError } from './errors.js';
const splitFlowItems = (inner) => {
    const items = [];
    let start = 0;
    let quote = 0;
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
        const cc = inner.charCodeAt(i);
        if (quote) {
            if (cc === 92) {
                i++;
            }
            else if (cc === quote)
                quote = 0;
        }
        else if (cc === 34 || cc === 39) {
            quote = cc;
        }
        else if (cc === 91 || cc === 123) {
            depth++;
        }
        else if (cc === 93 || cc === 125) {
            depth--;
        }
        else if (cc === 44 && depth === 0) {
            items.push(inner.slice(start, i).trim());
            start = i + 1;
        }
    }
    items.push(inner.slice(start).trim());
    return items;
};
const isNestedFlowConstruct = (item) => (item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) ||
    (item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125);
export const parseFlowSequence = (val, ctx, line) => {
    if (val.charCodeAt(0) !== 91 || val.charCodeAt(val.length - 1) !== 93)
        return null;
    const inner = val.slice(1, -1).trim();
    if (!inner)
        return [];
    const rawItems = splitFlowItems(inner);
    if (!ctx.strict && rawItems.length > 1 && !rawItems[rawItems.length - 1])
        rawItems.pop();
    return rawItems.map((item) => {
        if (!item) {
            if (ctx.strict)
                throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `LIMA: empty element in flow sequence at line ${line}` });
            return { kind: 'null', line };
        }
        if (item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) {
            throw new LimaError({
                code: 'INVALID_FLOW_SYNTAX', line,
                message: `LIMA: nested flow sequence not permitted at line ${line}: "${item}"`,
            });
        }
        if (item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125) {
            const nested = parseFlowMapping(item, ctx, line);
            if (nested !== null)
                return nested;
        }
        return parseQuotedOrTyped(item, ctx, line, false);
    });
};
export const parseFlowMapping = (val, ctx, line) => {
    if (val.charCodeAt(0) !== 123 || val.charCodeAt(val.length - 1) !== 125)
        return null;
    const inner = val.slice(1, -1).trim();
    const entries = new Map();
    if (!inner)
        return { kind: 'mapping', entries, line };
    for (const item of splitFlowItems(inner)) {
        if (!item) {
            if (ctx.strict)
                throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `LIMA: empty element in flow mapping at line ${line}` });
            continue;
        }
        const colonPos = item.indexOf(': ');
        if (colonPos === -1) {
            if (ctx.strict)
                throw new LimaError({
                    code: 'INVALID_FLOW_SYNTAX', line,
                    message: `LIMA: invalid flow mapping item (missing ": ") at line ${line}: "${item}"`,
                });
            return null;
        }
        const key = stripKeyQuotes(item.slice(0, colonPos).trim());
        checkKeyLength(key, () => line);
        checkDuplicateKeyMap(entries, key, line, ctx);
        const rawVal = item.slice(colonPos + 2).trim();
        if (isNestedFlowConstruct(rawVal)) {
            throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `LIMA: invalid flow nesting at line ${line}: "${rawVal}"` });
        }
        entries.set(key, parseQuotedOrTyped(rawVal, ctx, line, false));
    }
    return { kind: 'mapping', entries, line };
};
