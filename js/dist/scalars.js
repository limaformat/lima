/**
 * Core scalar grammar: the annotated `PositionedValue` tree type, dates,
 * numbers/type coercion, quoting/escaping, and the shared quoted-or-typed
 * scalar parser every value position (inline values, flow items, block
 * array/map items) builds on.
 */
import { LNull, LBool, LFloat, LInt, LString, LInstant } from './value.js';
import { checkScalarLimit, checkStringLimit } from './normalize.js';
import { LimaError } from './errors.js';
/**
 * `toType`'s classification result is always a plain `LimaValue` — the
 * number/date grammar in `toType` itself doesn't need to know or care what
 * final representation the caller wants. This is the one place that
 * decides: wrap it into the annotated `PositionedValue` tree (References'
 * `positionedBuilder`), or unwrap it straight into the public native shape
 * (Core's `nativeBuilder`, defined in core.ts) — see `builder.ts`.
 */
const wrap = (v, line, builder) => {
    switch (v.kind) {
        case 'null': return builder.null(line);
        case 'bool': return builder.bool(v.value, line);
        case 'int': return builder.int(v.value, line);
        case 'float': return builder.float(v.value, line);
        case 'string': return builder.string(v.value, line, false);
        case 'instant': return builder.instant(v.value, line);
        case 'array': return builder.array(v.items.map((i) => wrap(i, line, builder)), line);
        case 'mapping': {
            const entries = builder.createMapping();
            for (const [k, c] of v.entries)
                builder.setMapping(entries, k, wrap(c, line, builder));
            return builder.mapping(entries, line);
        }
    }
};
/** The `ValueBuilder<PositionedValue>` — reconstructs today's annotated tree exactly, for References. */
export const positionedBuilder = {
    null: (line) => ({ kind: 'null', line }),
    bool: (value, line) => ({ kind: 'bool', value, line }),
    int: (value, line) => ({ kind: 'int', value, line }),
    float: (value, line) => ({ kind: 'float', value, line }),
    string: (value, line, quoted) => ({ kind: 'string', value, line, quoted }),
    instant: (value, line) => ({ kind: 'instant', value, line }),
    array: (items, line) => ({ kind: 'array', items, line }),
    createMapping: () => new Map(),
    hasMappingKey: (entries, key) => entries.has(key),
    setMapping: (entries, key, value) => { entries.set(key, value); },
    mappingMaxDepth: (entries, depthOf) => {
        let max = 0;
        for (const value of entries.values()) {
            if (value.kind === 'array' || value.kind === 'mapping')
                max = Math.max(max, depthOf(value));
        }
        return max;
    },
    mapping: (entries, line) => ({ kind: 'mapping', entries, line }),
};
/** Strips position/quoted-origin annotations, recursively — the public parseCore() projection. */
export const toPlainValue = (v) => {
    switch (v.kind) {
        case 'null': return LNull;
        case 'bool': return LBool(v.value);
        case 'int': return LInt(v.value);
        case 'float': return LFloat(v.value);
        case 'string': return LString(v.value);
        case 'instant': return LInstant(v.value);
        case 'array': return { kind: 'array', items: v.items.map(toPlainValue) };
        case 'mapping': {
            const entries = new Map();
            for (const [k, c] of v.entries)
                entries.set(k, toPlainValue(c));
            return { kind: 'mapping', entries };
        }
    }
};
// ─── Dates ──────────────────────────────────────────────────────────────────
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/;
const GERMAN_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const SLASH_DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => (m === 2 && isLeapYear(y)) ? 29 : DAYS_IN_MONTH[m - 1];
const parseDateUTC = (str, strict = false, line = 0) => {
    const invalid = () => {
        if (strict)
            throw new LimaError({ code: 'INVALID_DATE', line, message: `LIMA: invalid date "${str}" at line ${line}` });
        return null;
    };
    if (str.length === 10 && str.charCodeAt(4) === 45 && str.charCodeAt(7) === 45) {
        const d0 = str.charCodeAt(0) - 48, d1 = str.charCodeAt(1) - 48;
        const d2 = str.charCodeAt(2) - 48, d3 = str.charCodeAt(3) - 48;
        const d5 = str.charCodeAt(5) - 48, d6 = str.charCodeAt(6) - 48;
        const d8 = str.charCodeAt(8) - 48, d9 = str.charCodeAt(9) - 48;
        if ((d0 | d1 | d2 | d3 | d5 | d6 | d8 | d9) >= 0 &&
            d0 <= 9 && d1 <= 9 && d2 <= 9 && d3 <= 9 &&
            d5 <= 9 && d6 <= 9 && d8 <= 9 && d9 <= 9) {
            const year = d0 * 1000 + d1 * 100 + d2 * 10 + d3;
            const month = d5 * 10 + d6;
            const day = d8 * 10 + d9;
            if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
                return invalid();
            const result = new Date(0);
            result.setUTCFullYear(year, month - 1, day);
            return result;
        }
    }
    let y, mo, d, h = 0, mi = 0, s = 0, offsetMin = 0;
    const iso = ISO_DATE_RE.exec(str);
    const german = !iso ? GERMAN_DATE_RE.exec(str) : null;
    const slash = !iso && !german ? SLASH_DATE_RE.exec(str) : null;
    if (iso) {
        y = +iso[1];
        mo = +iso[2];
        d = +iso[3];
        h = iso[4] !== undefined ? +iso[4] : 0;
        mi = iso[5] !== undefined ? +iso[5] : 0;
        s = iso[6] !== undefined ? +iso[6] : 0;
        const offsetStr = iso[7];
        if (offsetStr && offsetStr !== 'Z') {
            const sign = offsetStr.charCodeAt(0) === 45 ? -1 : 1;
            const oh = +offsetStr.slice(1, 3);
            const om = +offsetStr.slice(4, 6);
            if (oh > 14 || om > 59 || (oh === 14 && om !== 0))
                return invalid();
            offsetMin = sign * (oh * 60 + om);
        }
    }
    else if (german) {
        d = +german[1];
        mo = +german[2];
        y = +german[3];
        h = german[4] !== undefined ? +german[4] : 0;
        mi = german[5] !== undefined ? +german[5] : 0;
        s = german[6] !== undefined ? +german[6] : 0;
    }
    else if (slash) {
        y = +slash[1];
        mo = +slash[2];
        d = +slash[3];
        h = slash[4] !== undefined ? +slash[4] : 0;
        mi = slash[5] !== undefined ? +slash[5] : 0;
        s = slash[6] !== undefined ? +slash[6] : 0;
    }
    else {
        return null;
    }
    if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) ||
        h > 23 || mi > 59 || s > 59)
        return invalid();
    const base = new Date(0);
    base.setUTCFullYear(y, mo - 1, d);
    base.setUTCHours(h, mi, s, 0);
    const result = new Date(base.getTime() - offsetMin * 60000);
    const utcYear = result.getUTCFullYear();
    if (utcYear < 1 || utcYear > 9999)
        return invalid();
    return result;
};
// ─── Numbers ────────────────────────────────────────────────────────────────
const NUMBER_RE = /^-?(?:(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const DATE_PRE_RE = /\d[\d\-:.\/a-zA-Z]{4,}/;
const isFloatForm = (str) => str.includes('.') || str.includes('e') || str.includes('E');
const isZeroLiteral = (str) => /^0+(\.0+)?$/.test(str.replace(/^-/, '').split(/[eE]/)[0]);
/**
 * Converts a raw token to its Lima value, per Core §6.4.1's explicit number
 * grammar (never `Number()`/`parseFloat()`, which accept far more than Lima
 * does) and the three §6.5.1 date shapes. Reference-shaped text (`($key)`,
 * `(%key)`) matches none of these and falls through to a plain string,
 * unrecognised and unresolved — Core has no concept of it at all.
 */
const toType = (str, strict = false, line = 0) => {
    if (str === '' || str === 'null' || str === '~')
        return LNull;
    if (str === 'true')
        return LBool(true);
    if (str === 'false')
        return LBool(false);
    const first = str.charCodeAt(0);
    // Every number and every supported date form starts with a digit, '-'
    // or '.'. Once the null/boolean literals above are excluded, any other
    // leading character is unconditionally a string; avoid both regexes and
    // the email/date prechecks for ordinary words, URLs and identifiers.
    if (!((first >= 48 && first <= 57) || first === 45 || first === 46))
        return LString(str);
    // Hex (0x/0X), octal (0o/0O), binary (0b/0B) — kept as strings (YAML 1.2 compatible).
    if (str.length > 2 && str.charCodeAt(0) === 48 &&
        (str.charCodeAt(1) === 120 || str.charCodeAt(1) === 88 ||
            str.charCodeAt(1) === 111 || str.charCodeAt(1) === 79 ||
            str.charCodeAt(1) === 98 || str.charCodeAt(1) === 66))
        return LString(str);
    if (NUMBER_RE.test(str)) {
        const n = Number(str);
        if (isFloatForm(str)) {
            if (!Number.isFinite(n)) {
                if (strict)
                    throw new LimaError({
                        code: 'INVALID_NUMBER', line,
                        message: `LIMA: float value overflows to a non-finite value at line ${line}: "${str}"`,
                    });
            }
            else if (n === 0 && !isZeroLiteral(str)) {
                if (strict)
                    throw new LimaError({
                        code: 'INVALID_NUMBER', line,
                        message: `LIMA: non-zero float value underflows to zero at line ${line}: "${str}"`,
                    });
            }
            else {
                return LFloat(n);
            }
        }
        else if (Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
            return LInt(n);
        }
        // Outside the safe integer range, or overflow/underflow already
        // handled above in non-strict mode: fall through to string.
    }
    if (!str.includes('@') && DATE_PRE_RE.test(str)) {
        const date = parseDateUTC(str, strict, line);
        if (date !== null)
            return LInstant(date);
    }
    return LString(str);
};
// ─── Scalar / quoting ──────────────────────────────────────────────────────
const ESCAPED_HASH_RE = /\\#/g;
const ANY_ESCAPE_RE = /\\(u[0-9a-fA-F]{0,4}|U[0-9a-fA-F]{0,8}|x[0-9a-fA-F]{0,2}|.)/gs;
const SINGLE_CHAR_ESCAPES = '"\\/bfnrt'; // deliberately excludes '0' — Core Appendix A: \0 is unknown, not a null shorthand.
const U_ESCAPE_RE = /^u([0-9a-fA-F]{4})$/;
const CAP_U_ESCAPE_RE = /^U([0-9a-fA-F]{8})$/;
const X_ESCAPE_RE = /^x([0-9a-fA-F]{2})$/;
const isValidEscape = (escape) => {
    if (escape.length === 1)
        return SINGLE_CHAR_ESCAPES.includes(escape);
    const u = escape.match(U_ESCAPE_RE);
    if (u) {
        const cp = parseInt(u[1], 16);
        return cp < 0xd800 || cp > 0xdfff;
    }
    const bigU = escape.match(CAP_U_ESCAPE_RE);
    if (bigU)
        return parseInt(bigU[1], 16) <= 0x10ffff;
    return X_ESCAPE_RE.test(escape);
};
export const unescapeDQ = (s, strict = false, line = 0) => {
    if (!s.includes('\\'))
        return s;
    if (strict) {
        for (const m of s.matchAll(ANY_ESCAPE_RE)) {
            if (!isValidEscape(m[0].slice(1))) {
                throw new LimaError({ code: 'INVALID_ESCAPE', line, message: `LIMA: unknown escape sequence "${m[0]}" at line ${line}` });
            }
        }
    }
    return s.replace(ANY_ESCAPE_RE, (full) => {
        const e = full.slice(1);
        if (!isValidEscape(e))
            return full;
        switch (e[0]) {
            case '"': return '"';
            case '\\': return '\\';
            case '/': return '/';
            case 'b': return '\b';
            case 'f': return '\f';
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case 'u': return String.fromCharCode(parseInt(e.slice(1), 16));
            case 'U': return String.fromCodePoint(parseInt(e.slice(1), 16));
            case 'x': return String.fromCharCode(parseInt(e.slice(1), 16));
            default: return full;
        }
    });
};
export const stripComment = (val) => {
    let quote = 0;
    for (let i = 0; i < val.length; i++) {
        const cc = val.charCodeAt(i);
        if (quote) {
            if (cc === 92)
                i++;
            else if (cc === quote)
                quote = 0;
        }
        else if (cc === 34 || cc === 39) {
            quote = cc;
        }
        else if (cc === 92 && val.charCodeAt(i + 1) === 35) {
            i++;
        }
        else if (cc === 35) {
            return val.slice(0, i).trimEnd().replace(ESCAPED_HASH_RE, '#');
        }
    }
    return val.replace(ESCAPED_HASH_RE, '#');
};
/** Strips a key's surrounding quotes (unescaping double-quoted keys), or returns it unchanged. */
export const stripKeyQuotes = (s) => {
    const f = s.charCodeAt(0);
    if (f === 39 && s.charCodeAt(s.length - 1) === 39)
        return s.slice(1, -1);
    if (f === 34 && s.charCodeAt(s.length - 1) === 34)
        return unescapeDQ(s.slice(1, -1));
    return s;
};
/**
 * Quoted-or-typed scalar, shared by every value position (top-level inline
 * values, flow-sequence/flow-mapping items, block-array scalar items).
 * `topLevel` gates two checks that only apply at the outermost resolveValue
 * call site in the legacy parser and are deliberately not extended to flow
 * items here, to keep this a faithful behavioral port: the "unclosed flow
 * bracket" throw and the "non-whitespace after closing quote" strict throw.
 */
export const parseQuotedOrTyped = (raw, ctx, line, topLevel, builder) => {
    const first = raw.charCodeAt(0);
    if (first === 34 || first === 39) {
        if (raw.charCodeAt(raw.length - 1) === first) {
            const unquoted = raw.slice(1, -1);
            const value = first === 34 ? unescapeDQ(unquoted, ctx.strict, line) : unquoted.replace(/\\'/g, "'");
            checkStringLimit(value, line);
            return builder.string(value, line, true);
        }
        if (topLevel && ctx.strict) {
            throw new LimaError({ code: 'INVALID_QUOTE', line, message: `LIMA: non-whitespace content after closing quote at line ${line}` });
        }
    }
    if (raw !== '' && raw !== 'null' && raw !== '~' && raw !== 'true' && raw !== 'false' &&
        !((first >= 48 && first <= 57) || first === 45 || first === 46)) {
        checkStringLimit(raw, line);
        return builder.string(raw, line, false);
    }
    const typed = toType(raw, ctx.strict, line);
    checkScalarLimit(typed, line);
    return wrap(typed, line, builder);
};
export const parseScalarValue = (raw, ctx, line, builder) => {
    const first = raw.charCodeAt(0);
    if (ctx.strict && (first === 91 || first === 123)) {
        throw new LimaError({
            code: 'INVALID_FLOW_SYNTAX', line,
            message: `LIMA: unclosed flow ${first === 91 ? 'sequence' : 'mapping'} at line ${line}`,
        });
    }
    return parseQuotedOrTyped(raw, ctx, line, true, builder);
};
