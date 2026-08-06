/**
 * Core §7 block collections (sequences and mappings) — a direct structural
 * port of the legacy block parser, generic over its output representation
 * (see `builder.ts`) so `parseCore` can build the public native result
 * directly, without also building the References-only annotated
 * `PositionedValue` tree it never needs. No reference-resolution concerns
 * at all (no `resolve()` call anywhere, no array-as-sequence-item
 * reference-shape check — that error class cannot occur here since Core
 * never resolves a reference in the first place).
 */
import { LString } from './value.js';
import { checkKeyLength, checkDuplicateKey, checkScalarLimit, NESTING_DEPTH_LIMIT } from './normalize.js';
import { stripKeyQuotes, unescapeDQ, stripComment, parseQuotedOrTyped, } from './scalars.js';
import { parseFlowMapping, parseFlowOrScalarValue } from './flow.js';
import { LimaError } from './errors.js';
import { isTrimWhitespace } from './chars.js';
import { BlockCursor } from './block-cursor.js';
const DASH_PREFIX_RE = /^-\s+/;
export const findKeySep = (s) => {
    const first = s.charCodeAt(0);
    if (first === 39 || first === 34) {
        let i = 1;
        while (i < s.length && s.charCodeAt(i) !== first)
            i++;
        if (s.charCodeAt(i + 1) === 58 && s.charCodeAt(i + 2) === 32)
            return i + 1;
        return -1;
    }
    return s.indexOf(': ');
};
/**
 * Recursively parses a block value from a mutable physical-line cursor over
 * the original source. Strings are materialized only when grammar or scalar
 * parsing needs their content.
 */
/** `source.slice(start, end).trim()` with no temporary untrimmed substring. */
const trimSlice = (source, start, end) => {
    if (start < end) {
        const first = source.charCodeAt(start);
        const last = source.charCodeAt(end - 1);
        // Printable ASCII cannot be consumed by trim(), except U+0020 SPACE.
        // Canonical frontmatter keys/values overwhelmingly have printable,
        // non-space ASCII boundaries, so avoid both Unicode predicate calls.
        if (first > 0x20 && first < 0x7f && last > 0x20 && last < 0x7f) {
            return source.slice(start, end);
        }
    }
    while (start < end && isTrimWhitespace(source.charCodeAt(start)))
        start++;
    while (end > start && isTrimWhitespace(source.charCodeAt(end - 1)))
        end--;
    return source.slice(start, end);
};
const cursorContent = (cursor) => cursor.source.slice(cursor.contentStart, cursor.lineEnd);
const cursorAfterDash = (cursor) => {
    const start = cursor.contentStart;
    const end = cursor.lineEnd;
    if (start + 1 === end)
        return '';
    let content = start + 1;
    if (!isTrimWhitespace(cursor.source.charCodeAt(content)))
        return cursor.source.slice(start, end);
    while (content < end && isTrimWhitespace(cursor.source.charCodeAt(content)))
        content++;
    return cursor.source.slice(content, end);
};
/** Shared block grammar consuming one mutable physical-line cursor. */
const parseCursorBlock = (cursor, baseIndent, ctx, baseLine, builder) => {
    let items = null;
    let entries = null;
    let pendingItem = null;
    const startLine = cursor.lineIndex;
    while (cursor.valid) {
        const line = baseLine + cursor.lineIndex;
        if (cursor.empty || cursor.firstCode === 35) {
            cursor.next();
            continue;
        }
        const indent = cursor.indent;
        if (indent < baseIndent)
            break;
        if (indent > baseIndent) {
            const trimmed = cursorContent(cursor);
            if (items !== null && pendingItem !== null) {
                const colonPos = findKeySep(trimmed);
                if (colonPos !== -1) {
                    const key = stripKeyQuotes(trimSlice(trimmed, 0, colonPos));
                    checkKeyLength(key, () => line);
                    let raw = trimSlice(trimmed, colonPos + 2, trimmed.length);
                    if (raw.includes('#'))
                        raw = stripComment(raw);
                    builder.setMapping(pendingItem, key, parseFlowOrScalarValue(raw, ctx, line, builder));
                    cursor.next();
                }
                else if (trimmed.endsWith(':')) {
                    const key = stripKeyQuotes(trimSlice(trimmed, 0, trimmed.length - 1));
                    checkKeyLength(key, () => line);
                    cursor.next();
                    while (cursor.valid && cursor.empty)
                        cursor.next();
                    if (cursor.valid && cursor.indent > indent) {
                        const nested = parseCursorBlock(cursor, cursor.indent, ctx, baseLine, builder);
                        builder.setMapping(pendingItem, key, nested ?? builder.null(line));
                    }
                    else
                        builder.setMapping(pendingItem, key, builder.null(line));
                }
                else {
                    if (ctx.strict)
                        throw new LimaError({ code: 'INVALID_INDENTATION', line,
                            message: `Lima: unexpected syntax in array item continuation at line ${line}: "${trimmed}"` });
                    cursor.next();
                }
            }
            else {
                if (ctx.strict)
                    throw new LimaError({ code: 'INVALID_INDENTATION', line,
                        message: `Lima: unexpected indentation at line ${line}: "${trimmed}"` });
                cursor.next();
            }
            continue;
        }
        if (cursor.firstCode === 45) {
            if (pendingItem !== null) {
                items.push(builder.mapping(pendingItem, line));
                pendingItem = null;
            }
            if (items === null)
                items = [];
            if (entries !== null) {
                if (ctx.strict)
                    throw new LimaError({ code: 'INVALID_INDENTATION', line,
                        message: `Lima: mixed array and map entries for the same key at line ${line}` });
                cursor.next();
                continue;
            }
            let afterDash = cursorAfterDash(cursor);
            if (afterDash.includes('#'))
                afterDash = stripComment(afterDash);
            const first = afterDash.charCodeAt(0);
            if (first !== 34 && first !== 39 && first !== 45 && first !== 123 &&
                afterDash.indexOf(': ') === -1 && !afterDash.endsWith(':')) {
                items.push(parseQuotedOrTyped(afterDash, ctx, line, false, builder));
                cursor.next();
                continue;
            }
            const flowMap = parseFlowMapping(afterDash, ctx, line, builder);
            const colonPos = findKeySep(afterDash);
            if (flowMap !== null) {
                items.push(flowMap);
                cursor.next();
            }
            else if (afterDash === '-' || DASH_PREFIX_RE.test(afterDash)) {
                if (ctx.strict)
                    throw new LimaError({ code: 'INVALID_INDENTATION', line,
                        message: `Lima: nested block sequence at line ${line}: "${cursorContent(cursor)}"` });
                items.push(builder.null(line));
                cursor.next();
                while (cursor.valid) {
                    if (cursor.empty || cursor.source.charCodeAt(cursor.contentStart) === 35) {
                        cursor.next();
                        continue;
                    }
                    if (cursor.indent <= baseIndent)
                        break;
                    cursor.next();
                }
            }
            else if (colonPos !== -1) {
                const keyFirst = afterDash.charCodeAt(0);
                const keyLast = afterDash.charCodeAt(colonPos - 1);
                const keyRaw = keyFirst > 0x20 && keyFirst < 0x7f && keyLast > 0x20 && keyLast < 0x7f
                    ? afterDash.slice(0, colonPos) : trimSlice(afterDash, 0, colonPos);
                const key = keyFirst === 34 || keyFirst === 39 ? stripKeyQuotes(keyRaw) : keyRaw;
                checkKeyLength(key, () => line);
                const valueStart = colonPos + 2;
                const valueFirst = afterDash.charCodeAt(valueStart);
                const valueLast = afterDash.charCodeAt(afterDash.length - 1);
                const raw = valueFirst > 0x20 && valueFirst < 0x7f && valueLast > 0x20 && valueLast < 0x7f
                    ? afterDash.slice(valueStart) : trimSlice(afterDash, valueStart, afterDash.length);
                pendingItem = builder.createMappingWith(key, parseFlowOrScalarValue(raw, ctx, line, builder));
                cursor.next();
                while (cursor.valid && cursor.indent > baseIndent) {
                    const continuationLine = baseLine + cursor.lineIndex;
                    const start = cursor.contentStart, end = cursor.lineEnd;
                    const cfirst = cursor.source.charCodeAt(start);
                    if (cfirst === 34 || cfirst === 39 || cfirst === 35)
                        break;
                    const sep = cursor.source.indexOf(': ', start);
                    if (sep === -1 || sep >= end)
                        break;
                    const keyLast = cursor.source.charCodeAt(sep - 1);
                    const ckey = cfirst > 0x20 && cfirst < 0x7f && keyLast > 0x20 && keyLast < 0x7f
                        ? cursor.source.slice(start, sep) : trimSlice(cursor.source, start, sep);
                    if (!ckey)
                        break;
                    checkKeyLength(ckey, () => continuationLine);
                    const valueStart = sep + 2;
                    const valueFirst = cursor.source.charCodeAt(valueStart);
                    const valueLast = cursor.source.charCodeAt(end - 1);
                    let value = valueFirst > 0x20 && valueFirst < 0x7f && valueLast > 0x20 && valueLast < 0x7f
                        ? cursor.source.slice(valueStart, end) : trimSlice(cursor.source, valueStart, end);
                    if (value.includes('#'))
                        value = stripComment(value);
                    builder.setMapping(pendingItem, ckey, parseFlowOrScalarValue(value, ctx, continuationLine, builder));
                    cursor.next();
                }
            }
            else if (afterDash.endsWith(':')) {
                const key = stripKeyQuotes(trimSlice(afterDash, 0, afterDash.length - 1));
                checkKeyLength(key, () => line);
                cursor.next();
                while (cursor.valid && cursor.empty)
                    cursor.next();
                if (cursor.valid && cursor.indent > baseIndent) {
                    const nested = parseCursorBlock(cursor, cursor.indent, ctx, baseLine, builder);
                    pendingItem = builder.createMappingWith(key, nested ?? builder.null(line));
                }
                else
                    pendingItem = builder.createMappingWith(key, builder.null(line));
            }
            else {
                const q = afterDash.charCodeAt(0);
                if ((q === 34 || q === 39) && afterDash.charCodeAt(afterDash.length - 1) === q) {
                    const inner = afterDash.slice(1, -1);
                    const value = q === 34 ? unescapeDQ(inner, ctx.strict, line) : inner.replace(/\\'/g, "'");
                    checkScalarLimit(LString(value), line);
                    items.push(builder.string(value, line, true));
                }
                else
                    items.push(parseQuotedOrTyped(afterDash, ctx, line, false, builder));
                cursor.next();
            }
        }
        else {
            const trimmed = cursorContent(cursor);
            if (items !== null) {
                if (ctx.strict)
                    throw new LimaError({ code: 'INVALID_INDENTATION', line,
                        message: `Lima: mixed map and array entries for the same key at line ${line}` });
                cursor.next();
                continue;
            }
            const colonPos = findKeySep(trimmed);
            if (colonPos !== -1) {
                if (entries === null)
                    entries = builder.createMapping();
                const key = stripKeyQuotes(trimSlice(trimmed, 0, colonPos));
                checkKeyLength(key, () => line);
                if (ctx.strict || ctx.onWarning !== undefined)
                    checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx);
                let raw = trimSlice(trimmed, colonPos + 2, trimmed.length);
                if (raw.includes('#'))
                    raw = stripComment(raw);
                builder.setMapping(entries, key, parseFlowOrScalarValue(raw, ctx, line, builder));
                cursor.next();
            }
            else if (trimmed.endsWith(':')) {
                if (entries === null)
                    entries = builder.createMapping();
                const key = stripKeyQuotes(trimSlice(trimmed, 0, trimmed.length - 1));
                checkKeyLength(key, () => line);
                if (ctx.strict || ctx.onWarning !== undefined)
                    checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx);
                cursor.next();
                while (cursor.valid && cursor.empty)
                    cursor.next();
                if (cursor.valid && cursor.indent > baseIndent) {
                    const nested = parseCursorBlock(cursor, cursor.indent, ctx, baseLine, builder);
                    builder.setMapping(entries, key, nested ?? builder.null(line));
                }
                else
                    builder.setMapping(entries, key, builder.null(line));
            }
            else {
                if (ctx.strict)
                    throw new LimaError({ code: 'INVALID_INDENTATION', line,
                        message: `Lima: indented freetext without a block scalar marker at line ${line}: "${trimmed}"` });
                cursor.next();
            }
        }
    }
    if (pendingItem !== null)
        items.push(builder.mapping(pendingItem, baseLine + startLine));
    return items !== null ? builder.array(items, baseLine + startLine) :
        entries !== null ? builder.mapping(entries, baseLine + startLine) : null;
};
export const parseBlockRange = (source, start, end, ctx, baseLine, builder, depthRisk) => {
    const cursor = new BlockCursor(source, start, end);
    if (!cursor.next())
        return null;
    while (cursor.valid && cursor.empty)
        cursor.next();
    if (!cursor.valid)
        return null;
    const baseIndent = cursor.asciiIndent;
    const value = parseCursorBlock(cursor, baseIndent, ctx, baseLine, builder);
    // Recursive block containers require strictly increasing integer
    // indentation. At one indentation level a sequence-item mapping can add
    // one container and Core flow syntax at most two more, so delta + 4 is a
    // conservative depth bound below the document root.
    if (cursor.maxIndent - baseIndent + 4 > NESTING_DEPTH_LIMIT)
        depthRisk.mayExceed = true;
    return value;
};
