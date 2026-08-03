import { repeatedScalar } from './repeated-scalar'
import { documentBytes } from './document-bytes'
import { nestedMappings } from './nested-mappings'
import { repeatedKey } from './repeated-key'
import { partialCount } from './partial-count'
import { partialNodeTree } from './partial-node-tree'
import { resultNodeExpansion } from './result-node-expansion'

/**
 * A generator's full output: the `.lima` input text plus, for generators
 * that exercise partial-related limits (References §6.2), the `partials`
 * map to parse it against. Most generators only need `input` — a plain
 * `string` return is normalized to `{ input }` with no partials.
 */
export interface GeneratorResult {
	input: string
	partials?: Record<string, unknown>
}

export type GeneratorFn = (parameters: Record<string, unknown>) => string | GeneratorResult

function normalize(result: string | GeneratorResult): GeneratorResult {
	return typeof result === 'string' ? { input: result } : result
}

/** First-stage generators, implemented per startauftrag.md. */
const IMPLEMENTED: Record<string, GeneratorFn> = {
	'repeated-scalar': repeatedScalar,
	'document-bytes': documentBytes,
	'nested-mappings': nestedMappings,
	'repeated-key': repeatedKey,
	'partial-count': partialCount,
	'partial-node-tree': partialNodeTree,
	'result-node-expansion': resultNodeExpansion,
}

export function runGenerator(name: string, parameters: Record<string, unknown>): GeneratorResult {
	const fn = IMPLEMENTED[name]
	if (fn) return normalize(fn(parameters))
	throw new Error(`generator "${name}" is unknown`)
}

export { IMPLEMENTED }
