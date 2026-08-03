import { requirePositiveInt, requireString } from './params'
import type { GeneratorResult } from './index'

/**
 * `partial-node-tree` — a single partial whose total node count (per the
 * References §6.2 `nodeCount` formula: `nodeCount(array) = 1 +
 * sum(nodeCount(element))`) is exactly `totalNodes`. Tests the
 * total-partial-node boundary (References §6.2, max 4,096 nodes across all
 * partials). Built as an array of `totalNodes - 1` scalar elements, so the
 * array itself contributes 1 node and each element contributes 1.
 *
 * Parameters: `totalNodes` (positive integer), optional `partialName`
 * (default `"big"`).
 */
export function partialNodeTree(parameters: Record<string, unknown>): GeneratorResult {
	const totalNodes = requirePositiveInt(parameters, 'totalNodes')
	const partialName = requireString(parameters, 'partialName', 'big')

	const elements = Array.from({ length: totalNodes - 1 }, () => 1)
	return { input: '', partials: { [partialName]: elements } }
}
