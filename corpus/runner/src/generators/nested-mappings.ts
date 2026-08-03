import { requireNonNegativeInt, requireString } from './params'

/**
 * `nested-mappings` — a document nested exactly `depth` levels deep, using
 * the same recursive depth definition as Core §9 (`depth(scalar) = 0`,
 * `depth(mapping) = 1 + depth(child)`, root mapping itself does not count).
 * `depth: 0` produces a flat `key: value` document; `depth: 16` produces the
 * maximum permitted nesting; `depth: 17` produces one level too many.
 *
 * Parameters: `depth` (non-negative integer), optional `key` (default
 * `"k"`, reused at every level), optional `leafValue` (default `"v"`).
 */
export function nestedMappings(parameters: Record<string, unknown>): string {
	const depth = requireNonNegativeInt(parameters, 'depth')
	const key = requireString(parameters, 'key', 'k')
	const leafValue = requireString(parameters, 'leafValue', 'v')

	const lines: string[] = []
	for (let level = 0; level < depth; level++) {
		lines.push('  '.repeat(level) + `${key}:`)
	}
	lines.push('  '.repeat(depth) + `${key}: ${leafValue}`)
	return lines.join('\n')
}
