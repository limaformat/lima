/**
 * Language-neutral result normalization and comparison, per
 * docs/corpus-design/README.md §8 and startauftrag.md task 5:
 *   - JS `Date` is compared as a typed Instant (by timestamp, not identity).
 *   - Mapping comparison is order-independent (member order is not
 *     semantically significant — Core spec §1).
 *   - Sequence comparison is order-sensitive.
 *   - Numeric comparison uses `Object.is` so `-0`/`+0` and `NaN` compare
 *     the way the corpus's typed host values (§5) intend, rather than
 *     IEEE-754 `===` semantics.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

export function corpusValuesEqual(actual: unknown, expected: unknown): boolean {
	if (actual instanceof Date || expected instanceof Date) {
		if (!(actual instanceof Date) || !(expected instanceof Date)) return false
		return Object.is(actual.getTime(), expected.getTime())
	}
	if (typeof actual === 'number' && typeof expected === 'number') {
		return Object.is(actual, expected)
	}
	if (Array.isArray(actual) || Array.isArray(expected)) {
		if (!Array.isArray(actual) || !Array.isArray(expected)) return false
		if (actual.length !== expected.length) return false
		return actual.every((item, i) => corpusValuesEqual(item, expected[i]))
	}
	if (isPlainObject(actual) || isPlainObject(expected)) {
		if (!isPlainObject(actual) || !isPlainObject(expected)) return false
		const actualKeys = Object.keys(actual)
		const expectedKeys = Object.keys(expected)
		if (actualKeys.length !== expectedKeys.length) return false
		return actualKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(expected, key) &&
				corpusValuesEqual(actual[key], expected[key])
		)
	}
	return actual === expected
}

/**
 * Produces human-readable mismatch descriptions for a FAIL report. Returns
 * an empty array when the values are equal under `corpusValuesEqual`.
 */
export function diffCorpusValues(actual: unknown, expected: unknown, path = '$'): string[] {
	if (corpusValuesEqual(actual, expected)) return []

	const isActualDate = actual instanceof Date
	const isExpectedDate = expected instanceof Date
	if (isActualDate || isExpectedDate) {
		return [`${path}: expected ${describe(expected)}, got ${describe(actual)}`]
	}

	if (Array.isArray(actual) && Array.isArray(expected)) {
		if (actual.length !== expected.length) {
			return [`${path}: expected array of length ${expected.length}, got length ${actual.length}`]
		}
		return actual.flatMap((item, i) => diffCorpusValues(item, expected[i], `${path}[${i}]`))
	}

	if (isPlainObject(actual) && isPlainObject(expected)) {
		const diffs: string[] = []
		const actualKeys = new Set(Object.keys(actual))
		const expectedKeys = new Set(Object.keys(expected))
		for (const key of expectedKeys) {
			if (!actualKeys.has(key)) diffs.push(`${path}.${key}: missing in actual result`)
		}
		for (const key of actualKeys) {
			if (!expectedKeys.has(key)) diffs.push(`${path}.${key}: unexpected key in actual result`)
		}
		for (const key of actualKeys) {
			if (expectedKeys.has(key)) {
				diffs.push(...diffCorpusValues(actual[key], expected[key], `${path}.${key}`))
			}
		}
		return diffs
	}

	return [`${path}: expected ${describe(expected)}, got ${describe(actual)}`]
}

function describe(value: unknown): string {
	if (value instanceof Date) return `Date(${value.toISOString?.() ?? 'Invalid Date'})`
	if (typeof value === 'string') return JSON.stringify(value)
	return String(value)
}

/**
 * JS-specific binding check (docs/corpus-design/README.md §8): a Lima
 * result must be a prototype-free plain object (Core spec §11.1) at every
 * nesting level, with only own, enumerable data properties — no inherited
 * members, accessors, or symbol keys smuggled through the prototype chain.
 * This is a binding check, not a language-neutral value comparison.
 */
export function hasOnlySafeOwnDataProperties(value: unknown): boolean {
	if (value === null || typeof value !== 'object') return true
	if (value instanceof Date) return true
	if (Array.isArray(value)) return value.every(hasOnlySafeOwnDataProperties)

	if (Object.getPrototypeOf(value) !== null) return false

	const descriptors = Object.getOwnPropertyDescriptors(value)
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key === 'symbol') return false
		const descriptor = descriptors[key as string]
		if (!descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) return false
	}

	return Object.values(value).every(hasOnlySafeOwnDataProperties)
}
