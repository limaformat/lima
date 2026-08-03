import { requirePositiveInt, requireString } from './params'

/**
 * `repeated-key` — a document with `count` distinct top-level keys
 * (`${keyPrefix}0`, `${keyPrefix}1`, ...). Used to test the top-level
 * key-count boundary (Core §9, 128 entries). Note: this produces distinct
 * keys, not a duplicate key repeated — duplicate-key handling has its own
 * dedicated hand-written cases (e.g. corpus/core/duplicate-key-nonstrict).
 *
 * Parameters: `count` (positive integer), optional `keyPrefix` (default
 * `"k"`), optional `value` (default `"v"`).
 */
export function repeatedKey(parameters: Record<string, unknown>): string {
	const count = requirePositiveInt(parameters, 'count')
	const keyPrefix = requireString(parameters, 'keyPrefix', 'k')
	const value = requireString(parameters, 'value', 'v')

	const lines: string[] = []
	for (let i = 0; i < count; i++) lines.push(`${keyPrefix}${i}: ${value}`)
	return lines.join('\n')
}
