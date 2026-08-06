/** Core §15.8 flow collections: `[...]` sequences and `{...}` mappings. */
import { checkKeyLength, checkDuplicateKey } from './normalize.js';
import { parseQuotedOrTyped, parseScalarValue, stripKeyQuotes } from './scalars.js';
import { LimaError } from './errors.js';
import { isTrimWhitespace } from './chars.js';
const trimStart = (source, start, end) => {
    while (start < end && isTrimWhitespace(source.charCodeAt(start)))
        start++;
    return start;
};
const trimEnd = (source, start, end) => {
    while (end > start && isTrimWhitespace(source.charCodeAt(end - 1)))
        end--;
    return end;
};
/** Stateful comma-item cursor over a flow container's original string. */
class FlowCursor {
    source;
    end;
    itemStart = 0;
    itemEnd = 0;
    nextStart;
    done = false;
    constructor(source, start, end) {
        this.source = source;
        this.end = end;
        this.nextStart = start;
    }
    next() {
        if (this.done)
            return false;
        let quote = 0;
        let depth = 0;
        let pos = this.nextStart;
        for (; pos < this.end; pos++) {
            const code = this.source.charCodeAt(pos);
            if (quote) {
                if (code === 92)
                    pos++;
                else if (code === quote)
                    quote = 0;
            }
            else if (code === 34 || code === 39)
                quote = code;
            else if (code === 91 || code === 123)
                depth++;
            else if (code === 93 || code === 125)
                depth--;
            else if (code === 44 && depth === 0)
                break;
        }
        this.itemStart = trimStart(this.source, this.nextStart, pos);
        this.itemEnd = trimEnd(this.source, this.itemStart, pos);
        if (pos < this.end)
            this.nextStart = pos + 1;
        else
            this.done = true;
        return true;
    }
    get isLast() { return this.done; }
}
const isNestedFlowConstruct = (item) => (item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) ||
    (item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125);
export const parseFlowSequence = (val, ctx, line, builder) => {
    if (val.charCodeAt(0) !== 91 || val.charCodeAt(val.length - 1) !== 93)
        return null;
    const innerStart = trimStart(val, 1, val.length - 1);
    const innerEnd = trimEnd(val, innerStart, val.length - 1);
    if (innerStart === innerEnd)
        return [];
    const items = [];
    const cursor = new FlowCursor(val, innerStart, innerEnd);
    let itemCount = 0;
    while (cursor.next()) {
        const start = cursor.itemStart, end = cursor.itemEnd;
        itemCount++;
        if (start === end && !ctx.strict && cursor.isLast && itemCount > 1)
            break;
        const item = val.slice(start, end);
        if (!item) {
            if (ctx.strict)
                throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `Lima: empty element in flow sequence at line ${line}` });
            items.push(builder.null(line));
            continue;
        }
        if (item.charCodeAt(0) === 91 && item.charCodeAt(item.length - 1) === 93) {
            throw new LimaError({
                code: 'INVALID_FLOW_SYNTAX', line,
                message: `Lima: nested flow sequence not permitted at line ${line}: "${item}"`,
            });
        }
        if (item.charCodeAt(0) === 123 && item.charCodeAt(item.length - 1) === 125) {
            const nested = parseFlowMapping(item, ctx, line, builder);
            if (nested !== null) {
                items.push(nested);
                continue;
            }
        }
        items.push(parseQuotedOrTyped(item, ctx, line, false, builder));
    }
    return items;
};
export const parseFlowMapping = (val, ctx, line, builder) => {
    if (val.charCodeAt(0) !== 123 || val.charCodeAt(val.length - 1) !== 125)
        return null;
    const innerStart = trimStart(val, 1, val.length - 1);
    const innerEnd = trimEnd(val, innerStart, val.length - 1);
    const entries = builder.createMapping();
    if (innerStart === innerEnd)
        return builder.mapping(entries, line);
    const cursor = new FlowCursor(val, innerStart, innerEnd);
    while (cursor.next()) {
        const itemStart = cursor.itemStart, itemEnd = cursor.itemEnd;
        const item = val.slice(itemStart, itemEnd);
        if (!item) {
            if (ctx.strict)
                throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `Lima: empty element in flow mapping at line ${line}` });
            continue;
        }
        const colonPos = val.indexOf(': ', itemStart);
        if (colonPos === -1 || colonPos >= itemEnd) {
            if (ctx.strict)
                throw new LimaError({
                    code: 'INVALID_FLOW_SYNTAX', line,
                    message: `Lima: invalid flow mapping item (missing ": ") at line ${line}: "${item}"`,
                });
            return null;
        }
        const keyStart = trimStart(val, itemStart, colonPos);
        const keyEnd = trimEnd(val, keyStart, colonPos);
        const key = stripKeyQuotes(val.slice(keyStart, keyEnd));
        checkKeyLength(key, () => line);
        if (ctx.strict || ctx.onWarning !== undefined) {
            checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx);
        }
        const valueStart = trimStart(val, colonPos + 2, itemEnd);
        const valueEnd = trimEnd(val, valueStart, itemEnd);
        const rawVal = val.slice(valueStart, valueEnd);
        if (isNestedFlowConstruct(rawVal)) {
            throw new LimaError({ code: 'INVALID_FLOW_SYNTAX', line, message: `Lima: invalid flow nesting at line ${line}: "${rawVal}"` });
        }
        builder.setMapping(entries, key, parseQuotedOrTyped(rawVal, ctx, line, false, builder));
    }
    return builder.mapping(entries, line);
};
/** Parses a value that may be a flow collection, without probing both flow parsers for ordinary scalars. */
export const parseFlowOrScalarValue = (raw, ctx, line, builder) => {
    const first = raw.charCodeAt(0);
    if (first === 91) {
        const sequence = parseFlowSequence(raw, ctx, line, builder);
        if (sequence !== null)
            return builder.array(sequence, line);
        return parseScalarValue(raw, ctx, line, builder);
    }
    else if (first === 123) {
        const mapping = parseFlowMapping(raw, ctx, line, builder);
        if (mapping !== null)
            return mapping;
        return parseScalarValue(raw, ctx, line, builder);
    }
    return parseQuotedOrTyped(raw, ctx, line, true, builder);
};
