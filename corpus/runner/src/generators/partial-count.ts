import { requirePositiveInt, requireString } from './params'
import type { GeneratorResult } from './index'

/**
 * `partial-count` — `count` distinct partial names (`p0`, `p1`, ...), each
 * a trivial scalar value. Tests the partial-name-count boundary (References
 * §6.2, max 128 partial names). The document itself is empty — partial
 * validation (References §6.2) happens before document parsing, so an
 * empty input is sufficient to exercise the limit.
 *
 * Parameters: `count` (positive integer), optional `namePrefix` (default `"p"`).
 */
export function partialCount(parameters: Record<string, unknown>): GeneratorResult {
	const count = requirePositiveInt(parameters, 'count')
	const namePrefix = requireString(parameters, 'namePrefix', 'p')

	const partials: Record<string, unknown> = {}
	for (let i = 0; i < count; i++) partials[`${namePrefix}${i}`] = 'v'
	return { input: '', partials }
}
