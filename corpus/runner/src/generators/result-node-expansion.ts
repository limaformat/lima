import { requirePositiveInt, requireString } from './params'
import type { GeneratorResult } from './index'

/**
 * `result-node-expansion` — `topLevelKeys` top-level keys, each a pure
 * reference to the *same* partial (`partialNodes` nodes, per the
 * References §6.2 `nodeCount` formula). Since a pure reference is a
 * structural deep copy (References §3.1), each reference multiplies the
 * final result's node count independently of the other references. Tests
 * the total-result-node boundary (References §6.2, max 65,536) — this is
 * exactly the "128 top-level keys each referencing the same 4,096-node
 * partial" scenario documented in docs/corpus-design/README.md §6.
 *
 * Parameters: `topLevelKeys` (positive integer), `partialNodes` (positive
 * integer), optional `keyPrefix` (default `"k"`), optional `partialName`
 * (default `"big"`).
 */
export function resultNodeExpansion(parameters: Record<string, unknown>): GeneratorResult {
	const topLevelKeys = requirePositiveInt(parameters, 'topLevelKeys')
	const partialNodes = requirePositiveInt(parameters, 'partialNodes')
	const keyPrefix = requireString(parameters, 'keyPrefix', 'k')
	const partialName = requireString(parameters, 'partialName', 'big')

	const elements = Array.from({ length: partialNodes - 1 }, () => 1)
	const lines: string[] = []
	for (let i = 0; i < topLevelKeys; i++) lines.push(`${keyPrefix}${i}: (%${partialName})`)

	return { input: lines.join('\n'), partials: { [partialName]: elements } }
}
