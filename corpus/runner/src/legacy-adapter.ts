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
		// Checked first: partial validation happens before document parsing
		// (References §5/§6.2), and its messages can otherwise collide with
		// later, more general patterns — e.g. "invalid partial ... invalid
		// date" would also match the plain `/invalid date/` rule below if
		// that were checked first.
		pattern: /invalid partial "([^"]+)" at path "([^"]+)"/,
		code: 'INVALID_PARTIAL',
		extract: (m) => ({ partial: m[1], path: m[2] }),
	},
	{
		pattern: /too many partials|partials exceed the combined maximum/,
		code: 'INVALID_PARTIAL',
	},
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
		// Core §7.2/§10.1: array-in-array — its own strict-error-list row,
		// grouped with INVALID_INDENTATION for the same reason as the
		// freetext-without-marker rule below (codes stay deliberately coarse).
		pattern: /nested block sequence/,
		code: 'INVALID_INDENTATION',
	},
	{
		// Core §6.1.5/§10.1: indented freetext with no `|` marker and no `:` —
		// its own strict-error-list row, but not distinct enough from other
		// block-structure errors to warrant a new code (error-api.md keeps the
		// codes deliberately coarse).
		pattern: /indented freetext without a block scalar marker/,
		code: 'INVALID_INDENTATION',
	},
	{
		pattern: /unknown escape sequence/,
		code: 'INVALID_ESCAPE',
	},
	{
		pattern: /invalid date/,
		code: 'INVALID_DATE',
	},
	{
		// Core §6.4.2: float overflow to a non-finite value, or a
		// syntactically non-zero float underflowing to zero — neither is a
		// date, quote, or resource-limit error, so INVALID_NUMBER was added.
		pattern: /float value overflows to a non-finite value|non-zero float value underflows to zero/,
		code: 'INVALID_NUMBER',
	},
	{
		// References §3.1/Appendix: a pure reference resolving to an array,
		// inserted as a sequence item, would produce a nested array —
		// forbidden by Core §7.2. Distinct from INVALID_INTERPOLATION, which
		// covers the equivalent string-interpolation rules (§3.5/§3.6).
		pattern: /resolves to an array, which cannot be inserted as a sequence item/,
		code: 'INVALID_REFERENCE_SHAPE',
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
		pattern: /empty element in flow sequence|empty element in flow mapping/,
		code: 'INVALID_FLOW_SYNTAX',
	},
	{
		// Core §7.4/§7.5: forbidden flow nesting — a sequence directly
		// containing another sequence, or a mapping containing any nested
		// flow construct at all. Throws in BOTH modes (see legacy-adapter's
		// module doc: this adapter only sees the message, not which mode
		// produced it, so one rule covers both).
		pattern: /nested flow sequence not permitted|invalid flow nesting/,
		code: 'INVALID_FLOW_SYNTAX',
	},
	{
		// Core §7.4/§7.5: a `[`/`{` value with no matching close.
		pattern: /unclosed flow (sequence|mapping)/,
		code: 'INVALID_FLOW_SYNTAX',
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
