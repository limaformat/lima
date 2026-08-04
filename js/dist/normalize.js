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
export const checkScalarLimit = (v, line) => {
    if (v.kind === 'string' && codepointLength(v.value) > SCALAR_LENGTH_LIMIT) {
        throw new LimaError({
            code: 'RESOURCE_LIMIT', line,
            message: `LIMA: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${line}`,
        });
    }
};
/**
 * `line` is a thunk, not a plain number: computing a top-level key's line
 * can trigger an O(document length) scan (see `keyLine` in core.ts) the very
 * first time it's called, and this check runs for every key in the
 * document. Evaluating it eagerly would pay that cost on every parse, even
 * though the overwhelming majority of keys never violate the limit — the
 * thunk defers it to the one branch that actually needs a line number.
 */
export const checkKeyLength = (key, line) => {
    if (codepointLength(key) > KEY_LENGTH_LIMIT) {
        const l = line();
        throw new LimaError({
            code: 'RESOURCE_LIMIT', line: l,
            message: `LIMA: key "${key}" exceeds maximum length of ${KEY_LENGTH_LIMIT} code points at line ${l}`,
        });
    }
};
export const checkDuplicateKey = (exists, key, line, ctx) => {
    if (!exists)
        return;
    const diagnostic = {
        code: 'DUPLICATE_KEY', line, key,
        message: `LIMA: duplicate key "${key}" at line ${line} — last value wins`,
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
