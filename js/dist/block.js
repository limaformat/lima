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
import { checkKeyLength, checkDuplicateKey, NESTING_DEPTH_LIMIT } from './normalize.js';
import { stripKeyQuotes, stripComment, stripCommentKeepEscapes, parseQuotedOrTyped, closingQuoteIndex, isValidKey, } from './scalars.js';
import { parseFlowMapping, parseFlowOrScalarValue } from './flow.js';
import { buildBlockScalar } from './block-scalar.js';
import { LimaError } from './errors.js';
import { isTrimWhitespace } from './chars.js';
import { BlockCursor } from './block-cursor.js';
const DASH_PREFIX_RE = /^-\s+/;
/**
 * A key's inline value text. If it is exactly `|`, consume the following
 * physical lines belonging to the Core §6.1.5 block scalar introduced by a
 * key at `keyIndent` and return the scalar; the cursor is left on the first
 * line past the scalar. Otherwise parse `raw` as an ordinary inline value
 * and advance one line. §6.1.5 places no top-level restriction on block
 * scalars, so this is the same primitive `core.ts` uses at the top level.
 */
/** Length of the `- ` (dash + whitespace) prefix on the cursor's current line. */
const dashPrefixLen = (cursor) => {
    const start = cursor.contentStart, end = cursor.lineEnd;
    if (start + 1 === end)
        return 1;
    let content = start + 1;
    while (content < end && isTrimWhitespace(cursor.source.charCodeAt(content)))
        content++;
    return content - start;
};
/** Codepoints of leading whitespace on `s` — for a value's column within its line. */
const leadingWsLen = (s) => s.length - s.trimStart().length;
/** A value's physical `raw` for References 2.0 token positions: a trailing
 * `#` comment removed (its `${…}`-shaped text is not part of the value, so
 * must not be scanned), but `\#` kept as written (§2.4 — a `\#` before a
 * token still occupies two source columns). */
const physicalRaw = (s) => (s.includes('#') ? stripCommentKeepEscapes(s) : s);
/** The `ReferenceSource` for an inline value on line `keyLine` at column
 * `valueCol`; `rawUndecoded` is the value text before comment stripping /
 * `\#` collapse (so a `\#` before a token doesn't shift its column). */
const inlineSource = (ctx, keyLine, valueCol, rawUndecoded) => ({
    raw: physicalRaw(rawUndecoded), line: keyLine, col: valueCol,
    tabAdjust: ctx.tabAdjust ? [ctx.tabAdjust[keyLine - 1] ?? 0] : undefined,
});
const inlineOrBlockScalar = (raw, keyIndent, keyLine, valueCol, rawUndecoded, cursor, ctx, builder) => {
    if (raw !== '|') {
        const value = parseFlowOrScalarValue(raw, ctx, keyLine, builder, inlineSource(ctx, keyLine, valueCol, rawUndecoded));
        cursor.next();
        return value;
    }
    cursor.next(); // past the `key: |` line
    const bodyLines = [];
    while (cursor.valid) {
        if (!cursor.empty && cursor.asciiIndent <= keyIndent)
            break;
        bodyLines.push(cursor.source.slice(cursor.lineStart, cursor.lineEnd));
        cursor.next();
    }
    return buildBlockScalar(bodyLines, keyIndent, keyLine, ctx, builder).value;
};
export const findKeySep = (s) => {
    const first = s.charCodeAt(0);
    if (first === 39 || first === 34) {
        // §5.1: the `: ` separator must sit outside the quoted key, so scan
        // past its closing quote first. Double-quoted keys honour `\"`; a
        // single-quoted key is literal (§5.2), so its first `'` closes.
        const close = closingQuoteIndex(s, false);
        if (close !== -1 && s.charCodeAt(close + 1) === 58 && s.charCodeAt(close + 2) === 32)
            return close + 1;
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
/**
 * Core §4 rule 7 / §6.1.3: comment lines (first non-whitespace character
 * `#`) do not affect base indentation and are skipped — including in the
 * lookahead that decides whether a bare key (`key:` with no inline value)
 * has any nested block at all. Advancing past a comment here, not only a
 * blank line, keeps that pre-check consistent with the same skip already
 * applied once inside an established block (`parseCursorBlock`'s own
 * `cursor.empty || cursor.firstCode === 35` check at the top of its loop).
 */
const skipEmptyAndCommentLines = (cursor) => {
    while (cursor.valid && (cursor.empty || cursor.firstCode === 35))
        cursor.next();
};
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
                const keyRaw = colonPos !== -1
                    ? trimSlice(trimmed, 0, colonPos)
                    : trimmed.endsWith(':') ? trimSlice(trimmed, 0, trimmed.length - 1) : '';
                if (keyRaw !== '' && !isValidKey(keyRaw)) {
                    // §5.1: not a usable key — skipped in both modes, as at the top level.
                    cursor.next();
                }
                else if (colonPos !== -1) {
                    const key = stripKeyQuotes(keyRaw, ctx.strict, line);
                    checkKeyLength(key, () => line);
                    const rawUndecoded = trimSlice(trimmed, colonPos + 2, trimmed.length);
                    let raw = rawUndecoded;
                    if (raw !== '|' && raw.includes('#'))
                        raw = stripComment(raw);
                    const valueCol = cursor.indent + colonPos + 2 + leadingWsLen(trimmed.slice(colonPos + 2));
                    builder.setMapping(pendingItem, key, inlineOrBlockScalar(raw, indent, line, valueCol, rawUndecoded, cursor, ctx, builder));
                }
                else if (trimmed.endsWith(':')) {
                    const key = stripKeyQuotes(keyRaw, ctx.strict, line);
                    checkKeyLength(key, () => line);
                    cursor.next();
                    skipEmptyAndCommentLines(cursor);
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
            const afterDashRaw = cursorAfterDash(cursor);
            let afterDash = afterDashRaw;
            if (afterDash.includes('#'))
                afterDash = stripComment(afterDash);
            const dashPfx = dashPrefixLen(cursor); // `- ` prefix, all ASCII
            const afterDashCol = cursor.indent + dashPfx;
            const afterDashTab = ctx.tabAdjust ? [ctx.tabAdjust[line - 1] ?? 0] : undefined;
            const first = afterDash.charCodeAt(0);
            if (first !== 34 && first !== 39 && first !== 45 && first !== 123 &&
                afterDash.indexOf(': ') === -1 && !afterDash.endsWith(':')) {
                items.push(parseQuotedOrTyped(afterDash, ctx, line, builder, { raw: physicalRaw(afterDashRaw), line, col: afterDashCol, tabAdjust: afterDashTab }));
                cursor.next();
                continue;
            }
            const flowMap = parseFlowMapping(afterDash, ctx, line, builder, { raw: physicalRaw(afterDashRaw), line, col: afterDashCol, tabAdjust: afterDashTab });
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
            else if (colonPos !== -1 && isValidKey(trimSlice(afterDash, 0, colonPos))) {
                const keyRaw = trimSlice(afterDash, 0, colonPos);
                const key = stripKeyQuotes(keyRaw, ctx.strict, line);
                checkKeyLength(key, () => line);
                const valueStart = colonPos + 2;
                const valueFirst = afterDash.charCodeAt(valueStart);
                const valueLast = afterDash.charCodeAt(afterDash.length - 1);
                const raw = valueFirst > 0x20 && valueFirst < 0x7f && valueLast > 0x20 && valueLast < 0x7f
                    ? afterDash.slice(valueStart) : trimSlice(afterDash, valueStart, afterDash.length);
                // The key sits after `- `, two columns past the dash.
                const valueCol = afterDashCol + valueStart + leadingWsLen(afterDash.slice(valueStart));
                pendingItem = builder.createMappingWith(key, inlineOrBlockScalar(raw, baseIndent + 2, line, valueCol, afterDashRaw.slice(valueStart), cursor, ctx, builder));
                while (cursor.valid && cursor.indent > baseIndent) {
                    const continuationLine = baseLine + cursor.lineIndex;
                    const ckeyIndent = cursor.asciiIndent;
                    const cfirst = cursor.source.charCodeAt(cursor.contentStart);
                    if (cfirst === 35)
                        break;
                    const contLine = trimSlice(cursor.source, cursor.contentStart, cursor.lineEnd);
                    const csep = findKeySep(contLine);
                    if (csep === -1)
                        break;
                    const ckeyRaw = trimSlice(contLine, 0, csep);
                    if (!isValidKey(ckeyRaw))
                        break;
                    const ckey = stripKeyQuotes(ckeyRaw, ctx.strict, continuationLine);
                    if (!ckey)
                        break;
                    checkKeyLength(ckey, () => continuationLine);
                    const valueUndecoded = trimSlice(contLine, csep + 2, contLine.length);
                    let value = valueUndecoded;
                    if (value !== '|' && value.includes('#'))
                        value = stripComment(value);
                    // contLine starts exactly at contentStart (no leading trim), so
                    // the value's column is the indent plus its offset in contLine.
                    const cValueCol = cursor.indent + csep + 2 + leadingWsLen(contLine.slice(csep + 2));
                    builder.setMapping(pendingItem, ckey, inlineOrBlockScalar(value, ckeyIndent, continuationLine, cValueCol, valueUndecoded, cursor, ctx, builder));
                }
            }
            else if (afterDash.endsWith(':') && isValidKey(trimSlice(afterDash, 0, afterDash.length - 1))) {
                const key = stripKeyQuotes(trimSlice(afterDash, 0, afterDash.length - 1), ctx.strict, line);
                checkKeyLength(key, () => line);
                // §7.1 rule 3 / §7.2: sibling keys of an object item align at
                // the column of the first key *after* `- `; a nested block
                // must be indented deeper than that column, not merely deeper
                // than the item's dash. A line at the key's own column is the
                // next sibling key, so the bare key is `null`.
                let keyColumn = cursor.contentStart + 1;
                while (keyColumn < cursor.lineEnd && isTrimWhitespace(cursor.source.charCodeAt(keyColumn)))
                    keyColumn++;
                keyColumn -= cursor.lineStart;
                cursor.next();
                skipEmptyAndCommentLines(cursor);
                if (cursor.valid && cursor.indent > keyColumn) {
                    const nested = parseCursorBlock(cursor, cursor.indent, ctx, baseLine, builder);
                    pendingItem = builder.createMappingWith(key, nested ?? builder.null(line));
                }
                else
                    pendingItem = builder.createMappingWith(key, builder.null(line));
            }
            else {
                // A quoted-or-typed scalar item — parseQuotedOrTyped enforces
                // §10.1's unterminated / trailing-content strict checks.
                items.push(parseQuotedOrTyped(afterDash, ctx, line, builder, { raw: physicalRaw(afterDashRaw), line, col: afterDashCol, tabAdjust: afterDashTab }));
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
            const keyRaw = colonPos !== -1
                ? trimSlice(trimmed, 0, colonPos)
                : trimmed.endsWith(':') ? trimSlice(trimmed, 0, trimmed.length - 1) : '';
            if (keyRaw !== '' && !isValidKey(keyRaw)) {
                // §5.1: not a usable key — unrecognised line, skipped in both
                // modes (§10's strict list is closed and does not cover this).
                cursor.next();
            }
            else if (colonPos !== -1) {
                if (entries === null)
                    entries = builder.createMapping();
                const key = stripKeyQuotes(keyRaw, ctx.strict, line);
                checkKeyLength(key, () => line);
                if (ctx.strict || ctx.onWarning !== undefined)
                    checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx);
                const rawUndecoded = trimSlice(trimmed, colonPos + 2, trimmed.length);
                let raw = rawUndecoded;
                if (raw !== '|' && raw.includes('#'))
                    raw = stripComment(raw);
                const valueCol = cursor.indent + colonPos + 2 + leadingWsLen(trimmed.slice(colonPos + 2));
                builder.setMapping(entries, key, inlineOrBlockScalar(raw, baseIndent, line, valueCol, rawUndecoded, cursor, ctx, builder));
            }
            else if (trimmed.endsWith(':')) {
                if (entries === null)
                    entries = builder.createMapping();
                const key = stripKeyQuotes(keyRaw, ctx.strict, line);
                checkKeyLength(key, () => line);
                if (ctx.strict || ctx.onWarning !== undefined)
                    checkDuplicateKey(builder.hasMappingKey(entries, key), key, line, ctx);
                cursor.next();
                skipEmptyAndCommentLines(cursor);
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
    skipEmptyAndCommentLines(cursor);
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
