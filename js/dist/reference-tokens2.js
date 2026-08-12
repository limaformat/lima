const SEGMENT = '[a-zA-Z0-9_][a-zA-Z0-9_:-]*';
const DOC_PATH = `${SEGMENT}(?:\\.${SEGMENT})*`;
const PARTIAL_NAME = '[a-zA-Z0-9_][a-zA-Z0-9_:/-]*';
const PARTIAL_PATH = `${PARTIAL_NAME}(?:\\.${SEGMENT})*`;
export const PURE_REFERENCE_2 = new RegExp(`^(?:\\$\\{(${DOC_PATH})\\}|\\$\\((${PARTIAL_PATH})\\))$`);
const REFERENCE_2 = new RegExp(`\\$\\{(${DOC_PATH})\\}|\\$\\((${PARTIAL_PATH})\\)`, 'g');
const NO_TOKENS = [];
export const scanReferenceTokens2 = (value, firstLine, sourceSpans) => {
    if (!value.includes('${') && !value.includes('$('))
        return NO_TOKENS;
    REFERENCE_2.lastIndex = 0;
    const result = [];
    let line = firstLine;
    let lineStart = 0;
    let scanned = 0;
    let spanIndex = 0;
    for (const match of value.matchAll(REFERENCE_2)) {
        const index = match.index ?? 0;
        while (scanned < index) {
            if (value.charCodeAt(scanned) === 10) {
                line++;
                lineStart = scanned + 1;
            }
            scanned++;
        }
        while (sourceSpans && spanIndex + 1 < sourceSpans.length && sourceSpans[spanIndex + 1].start <= index)
            spanIndex++;
        const source = sourceSpans?.[spanIndex];
        result.push({
            token: match[0], index,
            line: source?.line ?? line,
            offset: source ? source.sourceOffset + index - source.start : index - lineStart,
            ...(match[1] !== undefined ? { documentPath: match[1] } : { partialPath: match[2] }),
        });
    }
    return result;
};
