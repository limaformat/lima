import { requirePositiveInt, requireString } from './params'

/**
 * `repeated-scalar` — a document with a single key whose scalar value is
 * `codePoint` repeated `length` times. Used to test scalar-length boundaries
 * (Core §9). Matches the parameters already used by
 * corpus/core/scalar-limit-above.json.
 *
 * Parameters: `key` (string), `codePoint` (single string, repeated as-is —
 * not necessarily one Unicode code point if a multi-char string is given),
 * `length` (positive integer, repeat count).
 */
export function repeatedScalar(parameters: Record<string, unknown>): string {
	const key = requireString(parameters, 'key', 'value')
	const codePoint = requireString(parameters, 'codePoint')
	const length = requirePositiveInt(parameters, 'length')
	return `${key}: ${codePoint.repeat(length)}`
}
