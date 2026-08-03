import { requirePositiveInt, requireString } from './params'

const encoder = new TextEncoder()

/** Keeps every line's scalar value well under the 16,384-code-point scalar
 * limit (Core §9), so this generator exercises the *document*-size boundary
 * in isolation instead of tripping the scalar-length limit first. */
const MAX_FILL_COUNT = 1000

/**
 * `document-bytes` — a document whose total UTF-8 byte size is exactly
 * `length`, spread across as many `kN: ...` top-level keys as needed. Used
 * to test the document-size boundary (Core §9, 64 KB / 65,536 bytes).
 *
 * An earlier version used a single key with one giant scalar. That is
 * wrong for the boundary values this generator exists to produce: a single
 * ~65,536-byte scalar trips the 16,384-code-point *scalar*-length limit
 * long before the document-size limit is reached. Splitting across many
 * short-valued keys isolates the intended boundary. The key count stays
 * far below the 128-entry top-level limit for any realistic `length`.
 *
 * Parameters: `length` (positive integer, total UTF-8 bytes including the
 * `\n` line separators), optional `fillCodePoint` (default `"x"`; its
 * UTF-8 byte length must evenly divide the space left after distributing
 * key prefixes and separators — throws otherwise, rather than silently
 * producing a document of the wrong size).
 */
export function documentBytes(parameters: Record<string, unknown>): string {
	const length = requirePositiveInt(parameters, 'length')
	const fillCodePoint = requireString(parameters, 'fillCodePoint', 'x')
	const fillBytes = encoder.encode(fillCodePoint).length

	const fillCounts: number[] = []
	let remaining = length
	let index = 0

	while (remaining > 0) {
		if (fillCounts.length > 0) remaining -= 1 // '\n' separator before this line
		const prefix = `k${index}: `
		const prefixBytes = encoder.encode(prefix).length
		if (remaining < prefixBytes) {
			throw new Error(`document-bytes: cannot fit another line into the remaining ${remaining} bytes`)
		}
		const budget = remaining - prefixBytes
		const fillCount = Math.min(MAX_FILL_COUNT, Math.floor(budget / fillBytes))
		fillCounts.push(fillCount)
		remaining -= prefixBytes + fillCount * fillBytes
		index++
	}

	if (remaining !== 0) {
		throw new Error(
			`document-bytes: length ${length} cannot be matched exactly — ${remaining} byte(s) left over ` +
				`(fillCodePoint byte length ${fillBytes} may not evenly divide the remainder)`
		)
	}

	return fillCounts.map((count, i) => `k${i}: ` + fillCodePoint.repeat(count)).join('\n')
}
