/**
 * Validator for corpus/schema/case.schema.json.
 *
 * This is a dedicated validator for this one, fixed schema rather than a
 * generic JSON Schema engine — the schema is small, known at build time,
 * and does not change per input. Avoiding a general-purpose dependency
 * (e.g. ajv) keeps the corpus foundation dependency-free, at the cost of
 * needing to keep this file in sync if case.schema.json's shape changes.
 * The enums below are read directly from the schema file, not duplicated
 * by hand, to reduce that risk.
 */

import schemaDoc from '../../schema/case.schema.json'

type JsonSchemaDoc = typeof schemaDoc

const SPEC_VALUES = schemaDoc.properties.spec.enum as readonly string[]
const GENERATOR_NAMES = schemaDoc.$defs.generator.properties.name.enum as readonly string[]
const DIAGNOSTIC_CODES = schemaDoc.$defs.diagnostic.properties.code.enum as readonly string[]
const ID_PATTERN = new RegExp(schemaDoc.properties.id.pattern)
const INPUT_FILE_PATTERN = new RegExp(schemaDoc.properties.inputFile.pattern)
const TAG_PATTERN = new RegExp(schemaDoc.properties.tags.items.pattern)
const INSTANT_PATTERN = new RegExp(
	(schemaDoc.$defs.corpusValue.oneOf[5] as any).properties.value.pattern
)
const HOST_DATE_SENTINELS = (schemaDoc.$defs.corpusValue.oneOf[7] as any).properties.value
	.enum as readonly string[]

export interface ValidationResult {
	valid: boolean
	errors: string[]
}

function fail(errors: string[], path: string, message: string): void {
	errors.push(`${path || '<root>'}: ${message}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateDiagnostic(value: unknown, path: string, errors: string[]): void {
	if (!isPlainObject(value)) return fail(errors, path, 'must be an object')
	const allowed = new Set([
		'line',
		'column',
		'token',
		'key',
		'partial',
		'path',
		'contains',
		'code',
	])
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) fail(errors, path, `unexpected property "${key}"`)
	}
	if (!('code' in value)) fail(errors, path, 'missing required property "code"')
	else if (!DIAGNOSTIC_CODES.includes(value.code as string)) {
		fail(errors, `${path}.code`, `must be one of ${DIAGNOSTIC_CODES.join(', ')}`)
	}
	for (const field of ['line', 'column'] as const) {
		if (field in value) {
			const v = value[field]
			if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
				fail(errors, `${path}.${field}`, 'must be an integer >= 1')
			}
		}
	}
	for (const field of ['token', 'key', 'partial', 'path', 'contains'] as const) {
		if (field in value && typeof value[field] !== 'string') {
			fail(errors, `${path}.${field}`, 'must be a string')
		}
	}
}

function validateCorpusValue(value: unknown, path: string, errors: string[]): void {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return
	if (typeof value === 'string') return
	if (Array.isArray(value)) {
		value.forEach((item, i) => validateCorpusValue(item, `${path}[${i}]`, errors))
		return
	}
	if (!isPlainObject(value)) {
		return fail(errors, path, 'must be null, boolean, number, string, array, or object')
	}
	if ('$type' in value) {
		const type = value.$type
		if (type === 'instant') {
			if (typeof value.value !== 'string' || !INSTANT_PATTERN.test(value.value)) {
				fail(errors, `${path}.value`, 'instant value must match YYYY-MM-DDTHH:MM:SSZ')
			}
		} else if (type === 'host-number') {
			if (!['nan', 'infinity', '-infinity', '-0'].includes(value.value as string)) {
				fail(errors, `${path}.value`, 'host-number value must be nan/infinity/-infinity/-0')
			}
		} else if (type === 'host-date') {
			if (!HOST_DATE_SENTINELS.includes(value.value as string)) {
				fail(errors, `${path}.value`, `host-date value must be one of ${HOST_DATE_SENTINELS.join(', ')}`)
			}
		} else {
			fail(errors, `${path}.$type`, `unknown marker type "${String(type)}"`)
		}
		return
	}
	for (const [key, entry] of Object.entries(value)) {
		validateCorpusValue(entry, `${path}.${key}`, errors)
	}
}

export function validateCase(doc: unknown): ValidationResult {
	const errors: string[] = []
	if (!isPlainObject(doc)) {
		return { valid: false, errors: ['<root>: must be an object'] }
	}

	const allowed = new Set([
		'id',
		'spec',
		'section',
		'description',
		'input',
		'inputFile',
		'options',
		'generator',
		'expect',
		'tags',
		'notes',
	])
	for (const key of Object.keys(doc)) {
		if (!allowed.has(key)) fail(errors, '', `unexpected property "${key}"`)
	}

	for (const required of ['id', 'spec', 'section', 'description', 'expect']) {
		if (!(required in doc)) fail(errors, '', `missing required property "${required}"`)
	}

	if (typeof doc.id === 'string' && !ID_PATTERN.test(doc.id)) {
		fail(errors, 'id', `must match ${ID_PATTERN}`)
	}
	if ('spec' in doc && !SPEC_VALUES.includes(doc.spec as string)) {
		fail(errors, 'spec', `must be one of ${SPEC_VALUES.join(', ')}`)
	}
	if ('section' in doc && (typeof doc.section !== 'string' || doc.section.length < 1)) {
		fail(errors, 'section', 'must be a non-empty string')
	}
	if ('description' in doc && (typeof doc.description !== 'string' || doc.description.length < 1)) {
		fail(errors, 'description', 'must be a non-empty string')
	}
	if ('input' in doc && typeof doc.input !== 'string') fail(errors, 'input', 'must be a string')
	if ('inputFile' in doc) {
		if (typeof doc.inputFile !== 'string' || !INPUT_FILE_PATTERN.test(doc.inputFile)) {
			fail(errors, 'inputFile', 'must be a bare filename ending in .lima or .bin')
		}
	}

	const inputSources = (['input', 'inputFile', 'generator'] as const).filter((k) => k in doc)
	if (inputSources.length !== 1) {
		fail(
			errors,
			'',
			`exactly one of input, inputFile, generator must be present (found: ${
				inputSources.length === 0 ? 'none' : inputSources.join(', ')
			})`
		)
	}

	if ('options' in doc) {
		const options = doc.options
		if (!isPlainObject(options)) fail(errors, 'options', 'must be an object')
		else {
			for (const key of Object.keys(options)) {
				if (key !== 'strict' && key !== 'partials') {
					fail(errors, 'options', `unexpected property "${key}"`)
				}
			}
			if ('strict' in options && typeof options.strict !== 'boolean') {
				fail(errors, 'options.strict', 'must be a boolean')
			}
			if ('partials' in options) {
				if (!isPlainObject(options.partials)) fail(errors, 'options.partials', 'must be an object')
				else {
					for (const [key, value] of Object.entries(options.partials)) {
						validateCorpusValue(value, `options.partials.${key}`, errors)
					}
				}
			}
		}
	}

	if ('generator' in doc) {
		const generator = doc.generator
		if (!isPlainObject(generator)) fail(errors, 'generator', 'must be an object')
		else {
			for (const key of Object.keys(generator)) {
				if (key !== 'name' && key !== 'parameters') {
					fail(errors, 'generator', `unexpected property "${key}"`)
				}
			}
			if (!('name' in generator)) fail(errors, 'generator', 'missing required property "name"')
			else if (!GENERATOR_NAMES.includes(generator.name as string)) {
				fail(errors, 'generator.name', `must be one of ${GENERATOR_NAMES.join(', ')}`)
			}
			if (!('parameters' in generator)) {
				fail(errors, 'generator', 'missing required property "parameters"')
			} else if (!isPlainObject(generator.parameters)) {
				fail(errors, 'generator.parameters', 'must be an object')
			}
		}
	}

	if ('tags' in doc) {
		if (!Array.isArray(doc.tags)) fail(errors, 'tags', 'must be an array')
		else {
			const seen = new Set<string>()
			doc.tags.forEach((tag, i) => {
				if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
					fail(errors, `tags[${i}]`, `must match ${TAG_PATTERN}`)
				}
				if (seen.has(tag as string)) fail(errors, `tags[${i}]`, 'duplicate tag')
				seen.add(tag as string)
			})
		}
	}

	if ('notes' in doc && typeof doc.notes !== 'string') fail(errors, 'notes', 'must be a string')

	if ('expect' in doc) {
		const expectation = doc.expect
		if (!isPlainObject(expectation)) fail(errors, 'expect', 'must be an object')
		else {
			for (const key of Object.keys(expectation)) {
				if (key !== 'result' && key !== 'error' && key !== 'warnings') {
					fail(errors, 'expect', `unexpected property "${key}"`)
				}
			}
			const expectationKinds = (['result', 'error'] as const).filter((k) => k in expectation)
			if (expectationKinds.length !== 1) {
				fail(
					errors,
					'expect',
					`exactly one of result, error must be present (found: ${
						expectationKinds.length === 0 ? 'none' : expectationKinds.join(', ')
					})`
				)
			}
			if ('result' in expectation) validateCorpusValue(expectation.result, 'expect.result', errors)
			if ('error' in expectation) validateDiagnostic(expectation.error, 'expect.error', errors)
			if ('warnings' in expectation) {
				if (!Array.isArray(expectation.warnings)) fail(errors, 'expect.warnings', 'must be an array')
				else {
					expectation.warnings.forEach((w, i) =>
						validateDiagnostic(w, `expect.warnings[${i}]`, errors)
					)
				}
			}
		}
	}

	return { valid: errors.length === 0, errors }
}

// Re-exported for callers that want the raw enums (e.g. the generator dispatcher).
export { SPEC_VALUES, GENERATOR_NAMES, DIAGNOSTIC_CODES }
export type { JsonSchemaDoc }
