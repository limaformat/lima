/**
 * Temporary adapter for the legacy hadley parser (js/src/index.ts).
 *
 * startauftrag.md explicitly allows a temporary adapter for legacy errors
 * while the corpus foundation is built. The legacy parser predates the
 * frozen 1.0 specs and throws plain `Error` objects with free-text messages
 * — it has no structured `code`/`line` fields. This adapter maps those
 * messages to the small public LimaDiagnostic shape (docs/corpus-design/
 * error-api.md) on a best-effort basis.
 *
 * This is intentionally imprecise: a message the adapter cannot confidently
 * classify is reported as unmapped rather than guessing a code, so that an
 * unmapped legacy error can never be silently miscounted as a PASS.
 */

import type { LimaDiagnostic, LimaDiagnosticCode } from './errors'

export type AdaptedDiagnostic =
	| { mapped: true; diagnostic: LimaDiagnostic }
	| { mapped: false; rawMessage: string }

interface Rule {
	pattern: RegExp
	code: LimaDiagnosticCode
	extract?: (match: RegExpMatchArray) => Partial<LimaDiagnostic>
}

const LINE_RE = /at line (\d+)/

const rules: Rule[] = [
	{
		pattern: /duplicate key "([^"]+)"/,
		code: 'DUPLICATE_KEY',
		extract: (m) => ({ key: m[1] }),
	},
	{
		pattern: /unresolved reference "\(([%$])([^)]+)\)"/,
		code: 'UNRESOLVED_REFERENCE',
		extract: (m) => ({ token: `(${m[1]}${m[2]})` }),
	},
	{
		pattern: /invalid flow mapping item/,
		code: 'INVALID_FLOW_SYNTAX',
	},
	{
		pattern: /unexpected indentation/,
		code: 'INVALID_INDENTATION',
	},
	{
		pattern: /unknown escape sequence/,
		code: 'INVALID_ESCAPE',
	},
	{
		// Quote-structure errors (not escape-content errors) — Core §10.1
		// lists this and "unterminated quoted string" as their own rows,
		// distinct from the §6.1.2 escape-content error table.
		pattern: /non-whitespace content after closing quote/,
		code: 'INVALID_QUOTE',
	},
	{
		// Core §5.2: space between a quoted key's closing quote and the
		// colon. Same INVALID_QUOTE category as the rule above.
		pattern: /space between closing quote and colon/,
		code: 'INVALID_QUOTE',
	},
	{
		pattern: /empty element in flow sequence/,
		code: 'INVALID_FLOW_SYNTAX',
	},
	{
		pattern: /invalid partial "([^"]+)" at path "([^"]+)"/,
		code: 'INVALID_PARTIAL',
		extract: (m) => ({ partial: m[1], path: m[2] }),
	},
	{
		pattern: /exceeds maximum (length|size)|too many top-level key entries|nesting depth exceeds maximum/,
		code: 'RESOURCE_LIMIT',
	},
	{
		pattern: /invalid interpolation of "([^"]+)"/,
		code: 'INVALID_INTERPOLATION',
		extract: (m) => ({ token: m[1] }),
	},
]

/**
 * Adapts a legacy error (thrown `Error`, or a captured `console.warn`
 * message string) to the small public diagnostic shape.
 */
export function adaptLegacyError(error: unknown): AdaptedDiagnostic {
	const message = error instanceof Error ? error.message : String(error)

	for (const rule of rules) {
		const match = message.match(rule.pattern)
		if (!match) continue
		const lineMatch = message.match(LINE_RE)
		const diagnostic: LimaDiagnostic = {
			code: rule.code,
			message,
			...(rule.extract ? rule.extract(match) : {}),
			...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
		}
		return { mapped: true, diagnostic }
	}

	return { mapped: false, rawMessage: message }
}
