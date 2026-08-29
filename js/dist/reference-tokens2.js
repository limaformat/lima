/** Reference tokens recorded while the annotated Core tree is being built. */
const SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*';
const DOC_PATH = `${SEGMENT}(?:\\.${SEGMENT})*`;
const PARTIAL_NAME = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*';
const PARTIAL_PATH = `${PARTIAL_NAME}(?:\\.${SEGMENT})*`;
export const PURE_REFERENCE_2 = new RegExp(`^(?:\\$\\{(${DOC_PATH})\\}|\\$\\((${PARTIAL_PATH})\\))$`);
const REFERENCE_2 = new RegExp(`\\$\\{(${DOC_PATH})\\}|\\$\\((${PARTIAL_PATH})\\)`, 'g');
const NO_TOKENS = [];
/** Codepoint length of the UTF-16 slice `[a, b)` of `s`. */
const codepointLen = (s, a, b) => {
    let n = 0;
    for (let i = a; i < b;) {
        i += s.codePointAt(i) > 0xffff ? 2 : 1;
        n++;
    }
    return n;
};
/** Splice points (decoded value order): token text, UTF-16 index, path. */
const scanDecoded = (value) => {
    REFERENCE_2.lastIndex = 0;
    const out = [];
    for (const m of value.matchAll(REFERENCE_2)) {
        out.push({
            token: m[0], index: m.index ?? 0,
            ...(m[1] !== undefined ? { documentPath: m[1] } : { partialPath: m[2] }),
        });
    }
    return out;
};
/** Physical `(line, offset)` of each token, in source order, from the raw text. */
const scanPhysical = (raw, firstLine, firstCol, tabAdjust) => {
    REFERENCE_2.lastIndex = 0;
    const out = [];
    let scanned = 0;
    let line = firstLine;
    let col = firstCol;
    let lineIndex = 0;
    for (const m of raw.matchAll(REFERENCE_2)) {
        const idx = m.index ?? 0;
        while (scanned < idx) {
            const cp = raw.codePointAt(scanned);
            if (cp === 10) {
                line++;
                col = 0;
                lineIndex++;
            }
            else
                col++;
            scanned += cp > 0xffff ? 2 : 1;
        }
        out.push({ line, offset: col - (tabAdjust?.[lineIndex] ?? 0) });
    }
    return out;
};
export const scanReferenceTokens2 = (value, source) => {
    if (!value.includes('${') && !value.includes('$('))
        return NO_TOKENS;
    const decoded = scanDecoded(value);
    if (decoded.length === 0)
        return NO_TOKENS;
    // The raw and decoded scans see the same tokens in the same order —
    // `\#` collapse and `^^` merge never add or remove a `${…}` / `$(…)`.
    const physical = source === undefined
        ? scanPhysical(value, 1, 0)
        : scanPhysical(source.raw ?? value, source.line, source.col, source.tabAdjust);
    if (physical.length !== decoded.length) {
        throw new Error(`Lima internal: reference token count mismatch (raw ${physical.length}, decoded ${decoded.length})`);
    }
    return decoded.map((d, i) => ({ ...d, line: physical[i].line, offset: physical[i].offset }));
};
