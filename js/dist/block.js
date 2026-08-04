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
import { checkKeyLength, checkDuplicateKeyMap, checkScalarLimit } from './normalize.js';
import { stripKeyQuotes, unescapeDQ, stripComment, parseQuotedOrTyped, parseScalarValue, } from './scalars.js';
import { parseFlowSequence, parseFlowMapping } from './flow.js';
import { LimaError } from './errors.js';
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
 * Recursively parses a block value (array or mapping) from an array of
 * lines.
 */
export const parseBlock = (lines, startIdx, baseIndent, ctx, baseLine, builder) => {
    let items = null;
    let entries = null;
    let pendingItem = null;
    let idx = startIdx;
    while (idx < lines.length) {
        const line = lines[idx];
        const trimmed = line.trimStart();
        if (!trimmed) {
            idx++;
            continue;
        }
        if (trimmed.charCodeAt(0) === 35) {
            idx++;
            continue;
        }
        const indent = line.length - trimmed.length;
        if (indent < baseIndent)
            break;
        if (indent > baseIndent) {
            if (items !== null && pendingItem !== null) {
                const colonPos = findKeySep(trimmed);
                if (colonPos !== -1) {
                    const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim());
                    checkKeyLength(itemKey, () => baseLine + idx);
                    const itemVal = stripComment(trimmed.slice(colonPos + 2).trim());
                    const flowSeq = parseFlowSequence(itemVal, ctx, baseLine + idx, builder);
                    const flowMap = flowSeq === null ? parseFlowMapping(itemVal, ctx, baseLine + idx, builder) : null;
                    pendingItem.set(itemKey, flowSeq !== null
                        ? builder.array(flowSeq, baseLine + idx)
                        : (flowMap !== null ? flowMap : parseScalarValue(itemVal, ctx, baseLine + idx, builder)));
                    idx++;
                }
                else if (trimmed.endsWith(':')) {
                    const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim());
                    const keyLineNum = baseLine + idx;
                    checkKeyLength(itemKey, () => keyLineNum);
                    idx++;
                    let ni = idx;
                    while (ni < lines.length && !lines[ni].trim())
                        ni++;
                    if (ni < lines.length) {
                        const nextIndent = lines[ni].length - lines[ni].trimStart().length;
                        if (nextIndent > indent) {
                            const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder);
                            pendingItem.set(itemKey, nested ?? builder.null(keyLineNum));
                            idx = after;
                            continue;
                        }
                    }
                    pendingItem.set(itemKey, builder.null(keyLineNum));
                }
                else {
                    if (ctx.strict)
                        throw new LimaError({
                            code: 'INVALID_INDENTATION', line: baseLine + idx,
                            message: `LIMA: unexpected syntax in array item continuation at line ${baseLine + idx}: "${trimmed}"`,
                        });
                    idx++;
                }
            }
            else {
                if (ctx.strict)
                    throw new LimaError({
                        code: 'INVALID_INDENTATION', line: baseLine + idx,
                        message: `LIMA: unexpected indentation at line ${baseLine + idx}: "${trimmed}"`,
                    });
                idx++;
            }
            continue;
        }
        // ── indent === baseIndent ──────────────────────────────────────────
        const isList = trimmed.charCodeAt(0) === 45;
        if (isList) {
            if (pendingItem !== null) {
                items.push(builder.mapping(pendingItem, baseLine + idx));
                pendingItem = null;
            }
            if (items === null)
                items = [];
            if (entries !== null) {
                if (ctx.strict)
                    throw new LimaError({
                        code: 'INVALID_INDENTATION', line: baseLine + idx,
                        message: `LIMA: mixed array and map entries for the same key at line ${baseLine + idx}`,
                    });
                idx++;
                continue;
            }
            const afterDash = trimmed === '-' ? '' : stripComment(trimmed.replace(DASH_PREFIX_RE, ''));
            const flowMap = parseFlowMapping(afterDash, ctx, baseLine + idx, builder);
            const colonPos = findKeySep(afterDash);
            if (flowMap !== null) {
                items.push(flowMap);
                idx++;
            }
            else if (afterDash === '-' || DASH_PREFIX_RE.test(afterDash)) {
                if (ctx.strict)
                    throw new LimaError({
                        code: 'INVALID_INDENTATION', line: baseLine + idx,
                        message: `LIMA: nested block sequence at line ${baseLine + idx}: "${trimmed}"`,
                    });
                items.push(builder.null(baseLine + idx));
                idx++;
                while (idx < lines.length) {
                    const nextTrimmed = lines[idx].trimStart();
                    if (!nextTrimmed || nextTrimmed.charCodeAt(0) === 35) {
                        idx++;
                        continue;
                    }
                    if (lines[idx].length - nextTrimmed.length <= baseIndent)
                        break;
                    idx++;
                }
            }
            else if (colonPos !== -1) {
                const pendingKey = stripKeyQuotes(afterDash.slice(0, colonPos).trim());
                checkKeyLength(pendingKey, () => baseLine + idx);
                const pendingRaw = afterDash.slice(colonPos + 2).trim();
                const pendingFlowSeq = parseFlowSequence(pendingRaw, ctx, baseLine + idx, builder);
                const pendingFlowMap = pendingFlowSeq === null ? parseFlowMapping(pendingRaw, ctx, baseLine + idx, builder) : null;
                pendingItem = new Map();
                pendingItem.set(pendingKey, pendingFlowSeq !== null
                    ? builder.array(pendingFlowSeq, baseLine + idx)
                    : (pendingFlowMap !== null ? pendingFlowMap : parseScalarValue(pendingRaw, ctx, baseLine + idx, builder)));
                idx++;
            }
            else if (afterDash.endsWith(':')) {
                const itemKey = stripKeyQuotes(afterDash.slice(0, -1).trim());
                const keyLineNum = baseLine + idx;
                checkKeyLength(itemKey, () => keyLineNum);
                idx++;
                let ni = idx;
                while (ni < lines.length && !lines[ni].trim())
                    ni++;
                if (ni < lines.length) {
                    const nextIndent = lines[ni].length - lines[ni].trimStart().length;
                    if (nextIndent > baseIndent) {
                        const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder);
                        pendingItem = new Map();
                        pendingItem.set(itemKey, nested ?? builder.null(keyLineNum));
                        idx = after;
                        continue;
                    }
                }
                pendingItem = new Map();
                pendingItem.set(itemKey, builder.null(keyLineNum));
            }
            else {
                const qFirst = afterDash.charCodeAt(0);
                if ((qFirst === 34 || qFirst === 39) && afterDash.charCodeAt(afterDash.length - 1) === qFirst) {
                    const inner = afterDash.slice(1, -1);
                    const value = qFirst === 34 ? unescapeDQ(inner, ctx.strict, baseLine + idx) : inner.replace(/\\'/g, "'");
                    checkScalarLimit(LString(value), baseLine + idx);
                    items.push(builder.string(value, baseLine + idx, true));
                }
                else {
                    items.push(parseQuotedOrTyped(afterDash, ctx, baseLine + idx, false, builder));
                }
                idx++;
            }
        }
        else {
            // ── Map entry ────────────────────────────────────────────────────
            if (items !== null) {
                if (ctx.strict)
                    throw new LimaError({
                        code: 'INVALID_INDENTATION', line: baseLine + idx,
                        message: `LIMA: mixed map and array entries for the same key at line ${baseLine + idx}`,
                    });
                idx++;
                continue;
            }
            const colonPos = findKeySep(trimmed);
            if (colonPos !== -1) {
                if (entries === null)
                    entries = new Map();
                const itemKey = stripKeyQuotes(trimmed.slice(0, colonPos).trim());
                checkKeyLength(itemKey, () => baseLine + idx);
                checkDuplicateKeyMap(entries, itemKey, baseLine + idx, ctx);
                const itemVal = stripComment(trimmed.slice(colonPos + 2).trim());
                const flowSeq = parseFlowSequence(itemVal, ctx, baseLine + idx, builder);
                const flowMap = flowSeq === null ? parseFlowMapping(itemVal, ctx, baseLine + idx, builder) : null;
                entries.set(itemKey, flowSeq !== null
                    ? builder.array(flowSeq, baseLine + idx)
                    : (flowMap !== null ? flowMap : parseScalarValue(itemVal, ctx, baseLine + idx, builder)));
                idx++;
            }
            else if (trimmed.endsWith(':')) {
                if (entries === null)
                    entries = new Map();
                const itemKey = stripKeyQuotes(trimmed.slice(0, -1).trim());
                const keyLineNum = baseLine + idx;
                checkKeyLength(itemKey, () => keyLineNum);
                checkDuplicateKeyMap(entries, itemKey, keyLineNum, ctx);
                idx++;
                let ni = idx;
                while (ni < lines.length && !lines[ni].trim())
                    ni++;
                if (ni < lines.length) {
                    const nextIndent = lines[ni].length - lines[ni].trimStart().length;
                    if (nextIndent > baseIndent) {
                        const { value: nested, nextIdx: after } = parseBlock(lines, ni, nextIndent, ctx, baseLine, builder);
                        entries.set(itemKey, nested ?? builder.null(keyLineNum));
                        idx = after;
                        continue;
                    }
                }
                entries.set(itemKey, builder.null(keyLineNum));
            }
            else {
                if (ctx.strict)
                    throw new LimaError({
                        code: 'INVALID_INDENTATION', line: baseLine + idx,
                        message: `LIMA: indented freetext without a block scalar marker at line ${baseLine + idx}: "${trimmed}"`,
                    });
                idx++;
            }
        }
    }
    if (pendingItem !== null)
        items.push(builder.mapping(pendingItem, baseLine + startIdx));
    const value = items !== null ? builder.array(items, baseLine + startIdx) :
        entries !== null ? builder.mapping(entries, baseLine + startIdx) :
            null;
    return { value, nextIdx: idx };
};
