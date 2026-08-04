/**
 * Shared, domain-agnostic parsing primitives: the parse context threaded
 * through every module, Core §9's resource limits, and the length/duplicate
 * checks built on them. Every other Core module (`scalars.ts`, `flow.ts`,
 * `block.ts`, `core.ts`) sits above this one.
 */

import { type LimaValue, SCALAR_LENGTH_LIMIT, codepointLength } from './value.js'
import { LimaError, type LimaDiagnostic } from './errors.js'

export { SCALAR_LENGTH_LIMIT }

/** Core §11.2: the minimal `onWarning` diagnostic shape — message and line only. */
export type Diagnostic = { message: string; line: number }

/**
 * Threaded through the whole recursive descent instead of a bare `strict`
 * boolean, so `onWarning` reaches every call site that can emit a warning
 * (currently just duplicate-key detection) without growing every
 * function's parameter list further as new warning types are added.
 */
export type ParseContext = { strict: boolean; onWarning?: (diagnostic: Diagnostic) => void }

// Core §9 resource limits. All are hard errors in both modes.
export const DOCUMENT_SIZE_LIMIT = 65536
export const KEY_LENGTH_LIMIT = 128
export const TOP_LEVEL_KEY_LIMIT = 128
export const NESTING_DEPTH_LIMIT = 16

const utf8Encoder = new TextEncoder()
export const byteLength = (s: string): number => utf8Encoder.encode(s).length

export const checkStringLimit = (value: string, line: number): void => {
	if (codepointLength(value) > SCALAR_LENGTH_LIMIT) {
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line,
			message: `LIMA: scalar exceeds maximum length of ${SCALAR_LENGTH_LIMIT} code points at line ${line}`,
		})
	}
}

export const checkScalarLimit = (v: LimaValue, line: number): void => {
	if (v.kind === 'string') checkStringLimit(v.value, line)
}

/**
 * `line` is a thunk, not a plain number: computing a top-level key's line
 * can trigger an O(document length) scan (see `keyLine` in core.ts) the very
 * first time it's called, and this check runs for every key in the
 * document. Evaluating it eagerly would pay that cost on every parse, even
 * though the overwhelming majority of keys never violate the limit — the
 * thunk defers it to the one branch that actually needs a line number.
 */
export const checkKeyLength = (key: string, line: () => number): void => {
	if (codepointLength(key) > KEY_LENGTH_LIMIT) {
		const l = line()
		throw new LimaError({
			code: 'RESOURCE_LIMIT', line: l,
			message: `LIMA: key "${key}" exceeds maximum length of ${KEY_LENGTH_LIMIT} code points at line ${l}`,
		})
	}
}

export const checkDuplicateKey = (exists: boolean, key: string, line: number, ctx: ParseContext): void => {
	if (!exists) return
	const diagnostic = {
		code: 'DUPLICATE_KEY', line, key,
		message: `LIMA: duplicate key "${key}" at line ${line} — last value wins`,
	} satisfies LimaDiagnostic
	if (ctx.strict) throw new LimaError(diagnostic)
	// Core §11.2: "Implementations MUST NOT emit warnings to any implicit
	// output channel (e.g. console.warn)." Silently discarded when no
	// onWarning callback is provided — never a fallback to console.warn.
	// The public `Diagnostic` type is the spec-frozen {message, line} shape
	// (§11.2); the object actually delivered is the richer `LimaDiagnostic`
	// (a structural superset), letting an internal caller — such as the
	// conformance runner, which imports these modules directly — read
	// `.code` without parsing the message.
	ctx.onWarning?.(diagnostic)
}

export const checkDuplicateKeyMap = (entries: Map<string, unknown>, key: string, line: number, ctx: ParseContext): void =>
	checkDuplicateKey(entries.has(key), key, line, ctx)
