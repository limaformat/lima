/** Small parameter-validation helpers shared by the generator functions. */

export function requireString(
	parameters: Record<string, unknown>,
	name: string,
	fallback?: string
): string {
	const value = parameters[name]
	if (value === undefined && fallback !== undefined) return fallback
	if (typeof value !== 'string') {
		throw new Error(`generator parameter "${name}" must be a string`)
	}
	return value
}

export function requireNonNegativeInt(parameters: Record<string, unknown>, name: string): number {
	const value = parameters[name]
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`generator parameter "${name}" must be a non-negative integer`)
	}
	return value
}

export function requirePositiveInt(parameters: Record<string, unknown>, name: string): number {
	const value = requireNonNegativeInt(parameters, name)
	if (value < 1) throw new Error(`generator parameter "${name}" must be >= 1`)
	return value
}
