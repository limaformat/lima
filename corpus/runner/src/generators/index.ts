import { repeatedScalar } from './repeated-scalar'
import { documentBytes } from './document-bytes'
import { nestedMappings } from './nested-mappings'
import { repeatedKey } from './repeated-key'

export type GeneratorFn = (parameters: Record<string, unknown>) => string

/** First-stage generators, implemented per startauftrag.md. */
const IMPLEMENTED: Record<string, GeneratorFn> = {
	'repeated-scalar': repeatedScalar,
	'document-bytes': documentBytes,
	'nested-mappings': nestedMappings,
	'repeated-key': repeatedKey,
}

/**
 * Remaining generator names from case.schema.json's enum that are not yet
 * implemented. Listed explicitly (rather than inferred) so a schema change
 * that adds a new generator name surfaces as an "unknown generator" error
 * here instead of silently falling into this bucket.
 */
const NOT_YET_IMPLEMENTED = new Set(['partial-count', 'partial-node-tree', 'result-node-expansion'])

export function runGenerator(name: string, parameters: Record<string, unknown>): string {
	const fn = IMPLEMENTED[name]
	if (fn) return fn(parameters)
	if (NOT_YET_IMPLEMENTED.has(name)) {
		throw new Error(
			`generator "${name}" is not implemented yet — first-stage generators are: ${Object.keys(IMPLEMENTED).join(', ')}`
		)
	}
	throw new Error(`generator "${name}" is unknown`)
}

export { IMPLEMENTED, NOT_YET_IMPLEMENTED }
