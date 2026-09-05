/**
 * Shared, domain-agnostic parsing primitives: the parse context threaded
 * through every module, Core §9's resource limits, and the length/duplicate
 * checks built on them. Every other Core module (`scalars.ts`, `flow.ts`,
 * `block.ts`, `core.ts`) sits above this one.
 */
import { SCALAR_LENGTH_LIMIT, codepointLength } from './value.js';
import { LimaError } from './errors.js';
export { SCALAR_LENGTH_LIMIT };
// Core §9 resource limits. All are hard errors in both modes.
export const DOCUMENT_SIZE_LIMIT = 65536;
export const KEY_LENGTH_LIMIT = 128;
export const TOP_LEVEL_KEY_LIMIT = 128;
export const NESTING_DEPTH_LIMIT = 16;
const utf8Encoder = new TextEncoder();
export const byteLength = (s) => utf8Encoder.encode(s).length;
export const checkStringLimit = (value, line) => {
    // UTF-16 code-unit length is always >= Unicode code-point length. Short
    // values therefore cannot violate the limit and need no surrogate scan.
    if (value.length > SCALAR_LENGTH_LIMIT && codepointLength(value) > SCALAR_LENGTH_LIMIT) {
        throw new LimaError({
            code: 'RESOURCE_LIMIT', line,
            message: `Lima: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${line}`,
        });
    }
};
export const checkScalarLimit = (v, line) => {
    if (v.kind === 'string')
        checkStringLimit(v.value, line);
};
export const checkKeyLength = (key, line) => {
    if (key.length > KEY_LENGTH_LIMIT && codepointLength(key) > KEY_LENGTH_LIMIT) {
        throw new LimaError({
            code: 'RESOURCE_LIMIT', line,
            message: `Lima: key "${key}" exceeds maximum length of ${KEY_LENGTH_LIMIT} code points at line ${line}`,
        });
    }
};
export const checkDuplicateKey = (exists, key, line, ctx) => {
    if (!exists)
        return;
    const diagnostic = {
        code: 'DUPLICATE_KEY', line, key,
        message: `Lima: duplicate key "${key}" at line ${line} — last value wins`,
    };
    if (ctx.strict)
        throw new LimaError(diagnostic);
    // Core §11.2: "Implementations MUST NOT emit warnings to any implicit
    // output channel (e.g. console.warn)." Silently discarded when no
    // onWarning callback is provided — never a fallback to console.warn.
    // The public `Diagnostic` type is the spec-frozen {message, line} shape
    // (§11.2); the object actually delivered is the richer `LimaDiagnostic`
    // (a structural superset), letting an internal caller — such as the
    // conformance runner, which imports these modules directly — read
    // `.code` without parsing the message.
    ctx.onWarning?.(diagnostic);
};
export const checkDuplicateKeyMap = (entries, key, line, ctx) => checkDuplicateKey(entries.has(key), key, line, ctx);
