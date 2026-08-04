/**
 * Structured internal diagnostics. The public parser API (Core §11.3)
 * remains a plain `Error` with just `.message` — Core §11.3 explicitly
 * permits subclasses as long as `instanceof Error` and `.message` still
 * work, so `LimaError` carries the same message text plus additional,
 * non-normative fields (`code`, `line`, `token`, `key`, `partial`, `path`)
 * that let a caller (or the conformance corpus runner, which imports this
 * module directly rather than duplicating it) inspect *why* a parse failed
 * without re-parsing the message string.
 */
export class LimaError extends Error {
    code;
    line;
    column;
    token;
    key;
    partial;
    path;
    constructor(diagnostic) {
        super(diagnostic.message);
        this.name = 'LimaError';
        Object.assign(this, diagnostic);
    }
}
